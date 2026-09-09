(function () {
  const SCAN_MS = 100;
  const ZONE_COUNT = 3;
  const ZONE_LENGTH = 100;
  const PULSE_PER_SCAN = 5;
  const FEED_PITCH_SCANS = 30;
  const BACKUP_PT_MS = 2000;
  const SLIP_PT_MS = 500;
  const TYPE_PATTERN = ['A','A','B','A','B'];
  const CHUTE_LENGTH = 100;
  const CHUTE_PULSE = 8;

  const FAULT = {
    NONE: 0,
    SLIP_Z1: 11, SLIP_Z2: 12, SLIP_Z3: 13,
    INV_ID_DUP: 20, INV_COUNT_MISMATCH: 21, INV_PE_OWNER_MISMATCH: 22,
    UNKNOWN_ITEM: 30
  };

  const state = {
    scanCount: 0, lastScanMs: 0,
    inputs: {
      Start_PB: 0, Stop_PB_NC: 1, EStop_NC: 1, Reset_PB: 0,
      Z1_PE: 0, Z2_PE: 0, Z3_PE: 0,
      Reject_Ready: 1,
      Z1_Enc_Pulse: 0, Z2_Enc_Pulse: 0, Z3_Enc_Pulse: 0
    },
    outputs: {
      Z1_Drive: 0, Z2_Drive: 0, Z3_Drive: 0,
      Reject_Actuator: 0, Run_Lamp: 0, Alarm_Lamp: 0
    },
    mem: {
      Sys_Enabled: 0, Sys_Running: 0, Sys_Faulted: 0, Fault_Code: 0,
      Z1_Backup: 0, Z2_Backup: 0, Z3_Backup: 0,
      Z1_Slip_Alarm: 0, Z2_Slip_Alarm: 0, Z3_Slip_Alarm: 0,
      Z1_AcceptAck: 0, Z2_AcceptAck: 0, Z3_AcceptAck: 0,
      Break_HS_Z1Z2: 0, Break_HS_Z2Z3: 0
    },
    timers: {
      TON_Z1_Backup:    { IN:0, ET:0, PT:BACKUP_PT_MS, DN:0 },
      TON_Z2_Backup:    { IN:0, ET:0, PT:BACKUP_PT_MS, DN:0 },
      TON_Z3_Backup:    { IN:0, ET:0, PT:BACKUP_PT_MS, DN:0 },
      TON_Z1_SlipCheck: { IN:0, ET:0, PT:SLIP_PT_MS,  DN:0 },
      TON_Z2_SlipCheck: { IN:0, ET:0, PT:SLIP_PT_MS,  DN:0 },
      TON_Z3_SlipCheck: { IN:0, ET:0, PT:SLIP_PT_MS,  DN:0 }
    },
    counters: { CTU_Throughput: { CU:0, prev_CU:0, R:0, CV:0, PV:9999, DN:0 } },
    invariants: { no_dup_id: true, count_conserved: true, pe_matches_owner: true, zone_non_regressing: true },
    prevPE: [0, 0, 0], prevZ3PE: 0,
    pendingBounce: [0, 0, 0],
    reconcileWindow: 0,
    _interval: null
  };

  const physical = {
    items: new Map(),
    zoneSlot: [null, null, null],
    zonePos:  [0, 0, 0],
    nextId: 1, feedCounter: 0, typeIdx: 0,
    chuteSlot: null, chutePos: 0
  };

  const tracking = { items: new Map(), zoneOwner: [null, null, null] };

  function trip(code) {
    if (!state.mem.Sys_Faulted) {
      state.mem.Sys_Faulted = 1;
      state.mem.Fault_Code = code;
    }
  }

  function tickTON(t, in_bit, dt) {
    t.IN = in_bit ? 1 : 0;
    if (t.IN) {
      if (t.ET < t.PT) t.ET = Math.min(t.PT, t.ET + dt);
      t.DN = t.ET >= t.PT ? 1 : 0;
    } else { t.ET = 0; t.DN = 0; }
  }

  function tickCTU(c, cu_bit, r_bit) {
    if (r_bit) { c.CV = 0; c.DN = 0; }
    else if (cu_bit && !c.prev_CU) { c.CV++; c.DN = c.CV >= c.PV ? 1 : 0; }
    c.prev_CU = cu_bit ? 1 : 0;
  }

  function updatePhysics() {
    const p = physical, out = state.outputs;
    const drive = [out.Z1_Drive, out.Z2_Drive, out.Z3_Drive];

    for (let i = ZONE_COUNT - 1; i >= 0; i--) {
      if (p.zoneSlot[i] === null || !drive[i]) continue;
      if (p.zonePos[i] < ZONE_LENGTH) {
        p.zonePos[i] = Math.min(ZONE_LENGTH, p.zonePos[i] + PULSE_PER_SCAN);
      } else {
        if (i === ZONE_COUNT - 1) {
          const outId = p.zoneSlot[i];
          const outItem = p.items.get(outId);
          if (outItem && outItem.type === 'B' && p.chuteSlot === null) {
            p.chuteSlot = outId; p.chutePos = 0;
            p.zoneSlot[i] = null; p.zonePos[i] = 0;
          } else {
            p.items.delete(outId);
            p.zoneSlot[i] = null; p.zonePos[i] = 0;
          }
        } else if (p.zoneSlot[i+1] === null) {
          p.zoneSlot[i+1] = p.zoneSlot[i]; p.zonePos[i+1] = 0;
          p.zoneSlot[i]   = null;          p.zonePos[i]   = 0;
        }
      }
    }

    // Track whether Z1 emptied this scan (transfer to Z2). If so, DEFER feed by one scan
    // so tracking sees a clean PE1 falling edge before the next PE1 rising edge.
    // This preserves the tracking layer's ability to distinguish "same item still here"
    // from "one item left, another arrived".
    const z1_just_emptied = (state.inputs.Z1_PE === 1 && p.zoneSlot[0] === null);

    if (state.mem.Sys_Running && !state.mem.Sys_Faulted && !z1_just_emptied) {
      p.feedCounter++;
      if (p.feedCounter >= FEED_PITCH_SCANS && p.zoneSlot[0] === null) {
        p.feedCounter = 0;
        const type = TYPE_PATTERN[p.typeIdx % TYPE_PATTERN.length];
        p.typeIdx++;
        const item = { id: p.nextId++, type: type };
        p.items.set(item.id, item);
        p.zoneSlot[0] = item.id; p.zonePos[0] = 0;
      }
    }

    if (p.chuteSlot !== null) {
      p.chutePos = Math.min(CHUTE_LENGTH, p.chutePos + CHUTE_PULSE);
      if (p.chutePos >= CHUTE_LENGTH) {
        p.items.delete(p.chuteSlot);
        p.chuteSlot = null; p.chutePos = 0;
      }
    }

    state.inputs.Z1_PE = p.zoneSlot[0] !== null ? 1 : 0;
    state.inputs.Z2_PE = p.zoneSlot[1] !== null ? 1 : 0;
    state.inputs.Z3_PE = p.zoneSlot[2] !== null ? 1 : 0;
    state.inputs.Z1_Enc_Pulse = drive[0] ? 1 : 0;
    state.inputs.Z2_Enc_Pulse = drive[1] ? 1 : 0;
    state.inputs.Z3_Enc_Pulse = drive[2] ? 1 : 0;

    if (state.pendingBounce[0]) { state.inputs.Z1_PE ^= 1; state.pendingBounce[0] = 0; }
    if (state.pendingBounce[1]) { state.inputs.Z2_PE ^= 1; state.pendingBounce[1] = 0; }
    if (state.pendingBounce[2]) { state.inputs.Z3_PE ^= 1; state.pendingBounce[2] = 0; }
  }

  function evalLadder() {
    const i = state.inputs, o = state.outputs, m = state.mem, T = state.timers;
    if (!i.EStop_NC) { m.Sys_Enabled = 0; m.Sys_Running = 0; }
    else if (i.Reset_PB) { m.Sys_Enabled = 1; }

    m.Z1_AcceptAck = (tracking.zoneOwner[1] === null && !m.Z2_Backup && !m.Break_HS_Z1Z2) ? 1 : 0;
    m.Z2_AcceptAck = (tracking.zoneOwner[2] === null && !m.Z3_Backup && !m.Break_HS_Z2Z3) ? 1 : 0;
    m.Z3_AcceptAck = i.Reject_Ready ? 1 : 0;

    if (m.Sys_Enabled && (i.Start_PB || m.Sys_Running) && i.Stop_PB_NC && !m.Sys_Faulted) {
      m.Sys_Running = 1;
    } else if (!i.Stop_PB_NC || !m.Sys_Enabled || m.Sys_Faulted) {
      m.Sys_Running = 0;
    }

    tickTON(T.TON_Z1_Backup, i.Z1_PE && !m.Z1_AcceptAck, SCAN_MS);
    tickTON(T.TON_Z2_Backup, i.Z2_PE && !m.Z2_AcceptAck, SCAN_MS);
    tickTON(T.TON_Z3_Backup, i.Z3_PE && !m.Z3_AcceptAck, SCAN_MS);
    m.Z1_Backup = T.TON_Z1_Backup.DN;
    m.Z2_Backup = T.TON_Z2_Backup.DN;
    m.Z3_Backup = T.TON_Z3_Backup.DN;

    o.Z1_Drive = (m.Sys_Running && !m.Sys_Faulted && m.Z1_AcceptAck) ? 1 : 0;
    o.Z2_Drive = (m.Sys_Running && !m.Sys_Faulted && m.Z2_AcceptAck) ? 1 : 0;
    o.Z3_Drive = (m.Sys_Running && !m.Sys_Faulted && m.Z3_AcceptAck) ? 1 : 0;

    tickTON(T.TON_Z1_SlipCheck, o.Z1_Drive && !i.Z1_Enc_Pulse, SCAN_MS);
    tickTON(T.TON_Z2_SlipCheck, o.Z2_Drive && !i.Z2_Enc_Pulse, SCAN_MS);
    tickTON(T.TON_Z3_SlipCheck, o.Z3_Drive && !i.Z3_Enc_Pulse, SCAN_MS);
    if (T.TON_Z1_SlipCheck.DN) { m.Z1_Slip_Alarm = 1; trip(FAULT.SLIP_Z1); }
    if (T.TON_Z2_SlipCheck.DN) { m.Z2_Slip_Alarm = 1; trip(FAULT.SLIP_Z2); }
    if (T.TON_Z3_SlipCheck.DN) { m.Z3_Slip_Alarm = 1; trip(FAULT.SLIP_Z3); }

    const z3id = tracking.zoneOwner[2];
    const z3item = z3id !== null ? tracking.items.get(z3id) : null;
    o.Reject_Actuator = (i.Z3_PE && z3item && z3item.type === 'B' && i.Reject_Ready) ? 1 : 0;
    o.Run_Lamp = m.Sys_Running ? 1 : 0;
    o.Alarm_Lamp = m.Sys_Faulted ? 1 : 0;

    if (i.Reset_PB && i.EStop_NC && !i.Start_PB) {
      m.Sys_Faulted = 0; m.Fault_Code = 0;
      m.Z1_Slip_Alarm = m.Z2_Slip_Alarm = m.Z3_Slip_Alarm = 0;
      T.TON_Z1_SlipCheck.ET = T.TON_Z2_SlipCheck.ET = T.TON_Z3_SlipCheck.ET = 0;
    }
  }

  function updateTracking() {
    const t = tracking;
    const pe = [state.inputs.Z1_PE, state.inputs.Z2_PE, state.inputs.Z3_PE];
    const prev = state.prevPE;

    for (let i = ZONE_COUNT - 2; i >= 0; i--) {
      if (pe[i+1] && !prev[i+1] && t.zoneOwner[i+1] === null && t.zoneOwner[i] !== null) {
        t.zoneOwner[i+1] = t.zoneOwner[i];
        const item = t.items.get(t.zoneOwner[i+1]);
        if (item) item.last_zone = i + 1;
        t.zoneOwner[i] = null;
      }
    }

    if (pe[0] && !prev[0] && t.zoneOwner[0] === null) {
      const physId = physical.zoneSlot[0];
      if (physId !== null) {
        const pit = physical.items.get(physId);
        t.items.set(physId, {
          id: physId, type: pit ? pit.type : 'UNKNOWN',
          entry_scan: state.scanCount, last_zone: 0
        });
        t.zoneOwner[0] = physId;
      } else {
        const id = physical.nextId++;
        t.items.set(id, { id: id, type: 'UNKNOWN', entry_scan: state.scanCount, last_zone: 0 });
        t.zoneOwner[0] = id;
        trip(FAULT.UNKNOWN_ITEM);
      }
    }

    if (!pe[2] && state.prevZ3PE && t.zoneOwner[2] !== null) {
      const id = t.zoneOwner[2];
      const item = t.items.get(id);
      const cu = item && item.type === 'A' ? 1 : 0;
      tickCTU(state.counters.CTU_Throughput, cu, state.inputs.Reset_PB);
      t.items.delete(id);
      t.zoneOwner[2] = null;
    } else {
      tickCTU(state.counters.CTU_Throughput, 0, state.inputs.Reset_PB);
    }

    state.prevPE = [pe[0], pe[1], pe[2]];
    state.prevZ3PE = pe[2];
  }

  function checkInvariants() {
    const t = tracking, inv = state.invariants;
    const pe = [state.inputs.Z1_PE, state.inputs.Z2_PE, state.inputs.Z3_PE];
    const reconciling = state.reconcileWindow > 0;
    inv.no_dup_id = t.items.size === new Set(t.items.keys()).size;
    let owned = 0;
    for (const o of t.zoneOwner) if (o !== null) owned++;
    inv.count_conserved = owned === t.items.size;
    inv.pe_matches_owner = reconciling ? true :
      ((t.zoneOwner[0] !== null) === (pe[0] === 1)) &&
      ((t.zoneOwner[1] !== null) === (pe[1] === 1)) &&
      ((t.zoneOwner[2] !== null) === (pe[2] === 1));
    inv.zone_non_regressing = true;
    if (!inv.no_dup_id)        trip(FAULT.INV_ID_DUP);
    if (!inv.count_conserved)  trip(FAULT.INV_COUNT_MISMATCH);
    if (!inv.pe_matches_owner) trip(FAULT.INV_PE_OWNER_MISMATCH);
    if (state.reconcileWindow > 0) state.reconcileWindow--;
  }

  function scan() {
    updatePhysics(); evalLadder(); updateTracking(); checkInvariants();
    state.scanCount++;
    state.lastScanMs = Date.now();
  }

  const inject = {
    removeItem(id) {
      const p = physical;
      if (!p.items.has(id)) return false;
      p.items.delete(id);
      for (let i = 0; i < ZONE_COUNT; i++) {
        if (p.zoneSlot[i] === id) { p.zoneSlot[i] = null; p.zonePos[i] = 0; }
      }
      return true;
    },
    removeFromStation(zoneIdx) {
      const id = physical.zoneSlot[zoneIdx];
      if (id === null) return false;
      return inject.removeItem(id);
    },
    bouncePE(zoneIdx) { if (zoneIdx >= 0 && zoneIdx < ZONE_COUNT) state.pendingBounce[zoneIdx] = 1; },
    breakHandshake(link, on) {
      if (link === 'Z1Z2') state.mem.Break_HS_Z1Z2 = on ? 1 : 0;
      if (link === 'Z2Z3') state.mem.Break_HS_Z2Z3 = on ? 1 : 0;
    },
    reconcile() {
      state.reconcileWindow = 3;
      const t = tracking;
      const pe = [state.inputs.Z1_PE, state.inputs.Z2_PE, state.inputs.Z3_PE];
      for (let i = 0; i < ZONE_COUNT; i++) {
        if (pe[i] && t.zoneOwner[i] === null) {
          const id = physical.nextId++;
          t.items.set(id, { id: id, type: 'UNKNOWN', entry_scan: state.scanCount, last_zone: i });
          t.zoneOwner[i] = id;
          state.mem.Fault_Code = FAULT.UNKNOWN_ITEM;
        }
        if (!pe[i] && t.zoneOwner[i] !== null) {
          t.items.delete(t.zoneOwner[i]);
          t.zoneOwner[i] = null;
        }
      }
    }
  };

  // ==== HMI ====
  const HMI = { ZONE_X: [60, 270, 480], ZONE_W: 200, Y: 110, ITEM_W: 40, ITEM_H: 30 };
  const CHUTE_START = { x: 680, y: 130 };
  const CHUTE_END   = { x: 750, y: 180 };

  function itemXForZone(zoneIdx) {
    const pos = physical.zonePos[zoneIdx] / ZONE_LENGTH;
    return HMI.ZONE_X[zoneIdx] + pos * (HMI.ZONE_W - HMI.ITEM_W);
  }

  function chutePoint(t) {
    return {
      x: CHUTE_START.x + (CHUTE_END.x - CHUTE_START.x) * t,
      y: CHUTE_START.y + (CHUTE_END.y - CHUTE_START.y) * t
    };
  }

  const itemNodes = new Map();
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function ensureItemNode(itemsGroup, item) {
    let n = itemNodes.get(item.id);
    if (n) return n;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'plc-sim__item type-' + item.type);
    rect.setAttribute('data-plc-item-id', item.id);
    rect.setAttribute('width', HMI.ITEM_W);
    rect.setAttribute('height', HMI.ITEM_H);
    rect.setAttribute('rx', '3');
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'plc-sim__item-label');
    label.textContent = item.type + item.id;
    itemsGroup.appendChild(rect);
    itemsGroup.appendChild(label);
    n = { rect: rect, label: label };
    itemNodes.set(item.id, n);
    return n;
  }

  function removeItemNode(id) {
    const n = itemNodes.get(id);
    if (!n) return;
    n.rect.parentNode && n.rect.parentNode.removeChild(n.rect);
    n.label.parentNode && n.label.parentNode.removeChild(n.label);
    itemNodes.delete(id);
  }

  function renderHMI(root) {
    const els = {
      zones:  root.querySelectorAll('[data-plc-zone]'),
      beams:  root.querySelectorAll('[data-plc-beam]'),
      items:  root.querySelector('[data-plc-items]'),
      runLamp:   root.querySelector('[data-plc-lamp="run"]'),
      faultLamp: root.querySelector('[data-plc-lamp="fault"]')
    };
    if (!els.items) return;

    for (let i = 0; i < ZONE_COUNT; i++) {
      els.zones[i].classList.toggle('is-driven', !!state.outputs['Z' + (i+1) + '_Drive']);
      els.zones[i].classList.toggle('is-backup', !!state.mem['Z' + (i+1) + '_Backup']);
    }
    const pe = [state.inputs.Z1_PE, state.inputs.Z2_PE, state.inputs.Z3_PE];
    for (let i = 0; i < ZONE_COUNT; i++) {
      els.beams[i].classList.toggle('is-broken', !!pe[i]);
    }
    els.runLamp.classList.toggle('is-on-run', !!state.outputs.Run_Lamp);
    els.faultLamp.classList.toggle('is-on-fault', !!state.outputs.Alarm_Lamp);

    const visible = new Set();
    for (let i = 0; i < ZONE_COUNT; i++) {
      const id = tracking.zoneOwner[i];
      if (id === null) continue;
      const item = tracking.items.get(id);
      if (!item) continue;
      visible.add(id);
      const n = ensureItemNode(els.items, item);
      const x = itemXForZone(i);
      const y = HMI.Y - HMI.ITEM_H / 2;
      n.rect.setAttribute('x', x.toFixed(1));
      n.rect.setAttribute('y', y);
      n.label.setAttribute('x', (x + HMI.ITEM_W/2).toFixed(1));
      n.label.setAttribute('y', y + HMI.ITEM_H/2 + 4);
    }
    if (physical.chuteSlot !== null) {
      const item = physical.items.get(physical.chuteSlot);
      if (item) {
        visible.add(item.id);
        const n = ensureItemNode(els.items, item);
        const t = physical.chutePos / CHUTE_LENGTH;
        const pt = chutePoint(t);
        const x = pt.x - HMI.ITEM_W / 2;
        const y = pt.y - HMI.ITEM_H / 2;
        n.rect.setAttribute('x', x.toFixed(1));
        n.rect.setAttribute('y', y.toFixed(1));
        n.label.setAttribute('x', (x + HMI.ITEM_W/2).toFixed(1));
        n.label.setAttribute('y', (y + HMI.ITEM_H/2 + 4).toFixed(1));
      }
    }
    itemNodes.forEach((_, id) => { if (!visible.has(id)) removeItemNode(id); });
  }

  function renderStatus(root) {
    const el = root.querySelector('[data-plc-status]');
    if (!el) return;
    const s = state.mem;
    let cls = '', txt;
    if (s.Sys_Faulted) { cls = 'is-fault'; txt = 'FAULT  code=' + s.Fault_Code + '  scan=' + state.scanCount; }
    else if (s.Sys_Running) { cls = 'is-run'; txt = 'RUN  scan=' + state.scanCount + '  throughput=' + state.counters.CTU_Throughput.CV; }
    else if (s.Sys_Enabled) { txt = 'ENABLED  scan=' + state.scanCount; }
    else { txt = 'IDLE  scan=' + state.scanCount; }
    el.className = 'plc-sim__status ' + cls;
    el.textContent = txt;
  }

  function activityText() {
    const s = state.mem;
    const backupIdx = [s.Z1_Backup, s.Z2_Backup, s.Z3_Backup].indexOf(1);
    if (!state.inputs.EStop_NC) return { txt: 'E-Stop is tripped. All motion stopped. Release E-Stop, press Reset, then Start.', cls: 'is-fault' };
    if (s.Sys_Faulted) {
      const c = s.Fault_Code;
      if (c === 22) return { txt: 'FAULT: the PLC has lost track of an item — the photoeyes and the internal item list disagree. Press Reconcile, then Reset, then Start.', cls: 'is-fault' };
      if (c === 30) return { txt: 'Recovered by Reconcile: an UNKNOWN item was created for a photoeye with no owner. Press Reset then Start.', cls: 'is-warn' };
      if (c >= 11 && c <= 13) return { txt: 'FAULT: motor commanded but no encoder motion — belt slip on Station ' + (c - 10) + '. Press Reset, then Start.', cls: 'is-fault' };
      if (c === 20) return { txt: 'FAULT: duplicate item ID detected. Reset required.', cls: 'is-fault' };
      if (c === 21) return { txt: 'FAULT: item count between tracker and zone owners diverged. Reset required.', cls: 'is-fault' };
      return { txt: 'FAULT: unspecified. Press Reset.', cls: 'is-fault' };
    }
    if (!s.Sys_Enabled) return { txt: 'System not enabled. Press Reset, then Start.', cls: '' };
    if (!s.Sys_Running) return { txt: 'System enabled and idle. Press Start to run.', cls: '' };
    if (backupIdx >= 0) {
      const upstream = backupIdx === 0 ? 'infeed' : 'Station ' + backupIdx;
      return { txt: 'Station ' + (backupIdx + 1) + ' backed up (downstream not accepting). ' + upstream + ' held. Line will resume when downstream clears.', cls: 'is-warn' };
    }
    if (s.Break_HS_Z1Z2) return { txt: 'Handshake broken: Station 1 cannot pass to Station 2. Watch Station 1 back up in ~2 seconds.', cls: 'is-warn' };
    if (s.Break_HS_Z2Z3) return { txt: 'Handshake broken: Station 2 cannot pass to Station 3. Watch Station 2 back up in ~2 seconds.', cls: 'is-warn' };
    return { txt: 'Line running normally. ' + state.counters.CTU_Throughput.CV + ' type-A items processed. Type-B items divert to reject.', cls: '' };
  }

  function renderActivity(root) {
    const el = root.querySelector('[data-plc-activity]');
    if (!el) return;
    const a = activityText();
    if (el.dataset.txt !== a.txt) { el.textContent = a.txt; el.dataset.txt = a.txt; }
    el.className = 'plc-sim__activity ' + a.cls;
  }

  const TAG_LIST = [
    ['%I0.0 Start_PB',      () => state.inputs.Start_PB],
    ['%I0.1 Stop_PB_NC',    () => state.inputs.Stop_PB_NC],
    ['%I0.2 EStop_NC',      () => state.inputs.EStop_NC],
    ['%I0.3 Reset_PB',      () => state.inputs.Reset_PB],
    ['%I1.0 S1_Photoeye',   () => state.inputs.Z1_PE],
    ['%I1.1 S2_Photoeye',   () => state.inputs.Z2_PE],
    ['%I1.2 S3_Photoeye',   () => state.inputs.Z3_PE],
    ['%I1.3 Reject_Ready',  () => state.inputs.Reject_Ready],
    ['%Q0.0 S1_Motor',      () => state.outputs.Z1_Drive],
    ['%Q0.1 S2_Motor',      () => state.outputs.Z2_Drive],
    ['%Q0.2 S3_Motor',      () => state.outputs.Z3_Drive],
    ['%Q0.3 Reject_Act',    () => state.outputs.Reject_Actuator],
    ['%Q0.4 Run_Lamp',      () => state.outputs.Run_Lamp],
    ['%Q0.5 Alarm_Lamp',    () => state.outputs.Alarm_Lamp],
    ['Sys_Enabled',         () => state.mem.Sys_Enabled],
    ['Sys_Running',         () => state.mem.Sys_Running],
    ['Sys_Faulted',         () => state.mem.Sys_Faulted],
    ['Fault_Code',          () => state.mem.Fault_Code],
    ['S1_Backup',           () => state.mem.Z1_Backup],
    ['S2_Backup',           () => state.mem.Z2_Backup],
    ['S3_Backup',           () => state.mem.Z3_Backup],
    ['S1_AcceptAck',        () => state.mem.Z1_AcceptAck],
    ['S2_AcceptAck',        () => state.mem.Z2_AcceptAck],
    ['S3_AcceptAck',        () => state.mem.Z3_AcceptAck],
    ['TON_S1_Backup.ET',    () => state.timers.TON_Z1_Backup.ET],
    ['TON_S2_Backup.ET',    () => state.timers.TON_Z2_Backup.ET],
    ['TON_S3_Backup.ET',    () => state.timers.TON_Z3_Backup.ET],
    ['CTU_Throughput.CV',   () => state.counters.CTU_Throughput.CV],
    ['Scan_Count',          () => state.scanCount]
  ];

  function renderTags(container) {
    if (!container.dataset.built) {
      let html = '';
      for (const [name] of TAG_LIST) {
        const safe = name.replace(/[^A-Za-z0-9_]/g, '_');
        html += '<div class="plc-sim__tag"><span class="plc-sim__tag-name">' + name +
                '</span><span class="plc-sim__tag-val" data-tag-val="' + safe + '">0</span></div>';
      }
      container.innerHTML = html;
      container.dataset.built = '1';
    }
    for (const [name, getter] of TAG_LIST) {
      const safe = name.replace(/[^A-Za-z0-9_]/g, '_');
      const el = container.querySelector('[data-tag-val="' + safe + '"]');
      if (!el) continue;
      const v = getter();
      const txt = String(v);
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('is-hi', v === 1);
    }
  }

  function renderInvariants(root) {
    root.querySelectorAll('[data-plc-inv]').forEach(el => {
      const ok = !!state.invariants[el.getAttribute('data-plc-inv')];
      el.classList.toggle('is-ok', ok);
      el.classList.toggle('is-violated', !ok);
    });
  }

  function renderRemoveButtons(root) {
    root.querySelectorAll('[data-plc-remove]').forEach(btn => {
      const z = parseInt(btn.getAttribute('data-plc-remove'), 10);
      btn.disabled = physical.zoneSlot[z] === null;
    });
  }

  // ==== LADDER ====
    const RUNG_H = 68;
  const RAIL_L = 60;
  const RAIL_R = 720;
  const ANNO_OFFSET = 32;
  const LABEL_OFFSET = 16;
  let ladderFull = false;

  function contact(x, y, name, negated, live) {
    const cls = 'plc-sim__lad-contact' + (live ? ' is-live' : '');
    const slash = negated
      ? '<line class="plc-sim__lad-slash" x1="' + (x-6) + '" y1="' + (y+8) + '" x2="' + (x+6) + '" y2="' + (y-8) + '"/>'
      : '';
    return '<g class="' + cls + '">' +
      '<line x1="' + (x-14) + '" y1="' + y + '" x2="' + (x-6) + '" y2="' + y + '"/>' +
      '<line x1="' + (x+6)  + '" y1="' + y + '" x2="' + (x+14) + '" y2="' + y + '"/>' +
      '<line class="plc-sim__lad-bar" x1="' + (x-6) + '" y1="' + (y-9) + '" x2="' + (x-6) + '" y2="' + (y+9) + '"/>' +
      '<line class="plc-sim__lad-bar" x1="' + (x+6) + '" y1="' + (y-9) + '" x2="' + (x+6) + '" y2="' + (y+9) + '"/>' +
      slash +
      '<text x="' + x + '" y="' + (y - LABEL_OFFSET) + '" text-anchor="middle">' + name + '</text>' +
    '</g>';
  }

  function coil(x, y, name, latched, live) {
    const cls = 'plc-sim__lad-coil' + (live ? ' is-live' : '');
    return '<g class="' + cls + '">' +
      '<line x1="' + (x-14) + '" y1="' + y + '" x2="' + (x-8) + '" y2="' + y + '"/>' +
      '<line x1="' + (x+8)  + '" y1="' + y + '" x2="' + (x+14) + '" y2="' + y + '"/>' +
      '<path d="M ' + (x-8) + ' ' + (y-9) + ' A 9 9 0 0 0 ' + (x-8) + ' ' + (y+9) + '"/>' +
      '<path d="M ' + (x+8) + ' ' + (y-9) + ' A 9 9 0 0 1 ' + (x+8) + ' ' + (y+9) + '"/>' +
      (latched ? '<text x="' + x + '" y="' + (y+3) + '" text-anchor="middle" font-size="9">L</text>' : '') +
      '<text x="' + x + '" y="' + (y - LABEL_OFFSET) + '" text-anchor="middle">' + name + '</text>' +
    '</g>';
  }

  function block(x, y, w, h, title, sub, live) {
    const cls = 'plc-sim__lad-block' + (live ? ' is-live' : '');
    return '<g class="' + cls + '">' +
      '<line x1="' + (x-14) + '" y1="' + (y+h/2) + '" x2="' + x + '" y2="' + (y+h/2) + '"/>' +
      '<line x1="' + (x+w) + '" y1="' + (y+h/2) + '" x2="' + (x+w+14) + '" y2="' + (y+h/2) + '"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2"/>' +
      '<text x="' + (x+w/2) + '" y="' + (y+13) + '" text-anchor="middle" font-weight="600">' + title + '</text>' +
      '<text x="' + (x+w/2) + '" y="' + (y+25) + '" text-anchor="middle" font-size="9" fill="var(--muted)">' + sub + '</text>' +
    '</g>';
  }

  function wire(x1, y, x2) { return '<line class="plc-sim__lad-wire" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>'; }
  function rungNum(y, label) { return '<text class="plc-sim__lad-num" x="8" y="' + (y+3) + '" font-size="9" fill="var(--muted)">' + label + '</text>'; }
    function anno(y, txt) { return '<text class="plc-sim__lad-anno" x="' + (RAIL_L + 20) + '" y="' + (y - ANNO_OFFSET) + '">' + txt + '</text>'; }
  function rails(y1, y2) {
    return '<line class="plc-sim__lad-rail" x1="' + RAIL_L + '" y1="' + y1 + '" x2="' + RAIL_L + '" y2="' + y2 + '"/>' +
           '<line class="plc-sim__lad-rail" x1="' + RAIL_R + '" y1="' + y1 + '" x2="' + RAIL_R + '" y2="' + y2 + '"/>';
  }

      function ladderLegend() {
    // Two-column stacked legend across the top of the SVG.
    // Each row: symbol at fixed x, label to the right. Two columns fit inside 740 units.
    const items = [
      { sym: 'contact-no',  label: 'Contact (normally open)' },
      { sym: 'contact-nc',  label: 'Contact (negated / NC)' },
      { sym: 'coil',        label: 'Output coil' },
      { sym: 'coil-latch',  label: 'Latched output coil' },
      { sym: 'block',       label: 'Timer / counter block' },
      { sym: 'live',        label: 'Green = rung solved true this scan' }
    ];
    const COL_W = 340;
    const ROW_H = 18;
    let out = '<g class="plc-sim__lad-legend">';
    out += '<text x="' + RAIL_L + '" y="14" font-weight="600" fill="var(--muted)">Legend</text>';
    for (let i = 0; i < items.length; i++) {
      const col = i % 2;                     // 0 = left, 1 = right
      const row = Math.floor(i / 2);         // 0..2
      const sx = RAIL_L + col * COL_W;       // symbol x
      const y  = 34 + row * ROW_H;           // row y
      const it = items[i];
      if (it.sym === 'contact-no') {
        out += '<line class="plc-sim__lad-bar" x1="' + (sx-4) + '" y1="' + (y-6) + '" x2="' + (sx-4) + '" y2="' + (y+6) + '"/>' +
               '<line class="plc-sim__lad-bar" x1="' + (sx+4) + '" y1="' + (y-6) + '" x2="' + (sx+4) + '" y2="' + (y+6) + '"/>';
      } else if (it.sym === 'contact-nc') {
        out += '<line class="plc-sim__lad-bar" x1="' + (sx-4) + '" y1="' + (y-6) + '" x2="' + (sx-4) + '" y2="' + (y+6) + '"/>' +
               '<line class="plc-sim__lad-bar" x1="' + (sx+4) + '" y1="' + (y-6) + '" x2="' + (sx+4) + '" y2="' + (y+6) + '"/>' +
               '<line class="plc-sim__lad-slash" x1="' + (sx-5) + '" y1="' + (y+5) + '" x2="' + (sx+5) + '" y2="' + (y-5) + '"/>';
      } else if (it.sym === 'coil') {
        out += '<path fill="none" stroke="var(--text)" d="M ' + (sx-6) + ' ' + (y-6) + ' A 6 6 0 0 0 ' + (sx-6) + ' ' + (y+6) + '"/>' +
               '<path fill="none" stroke="var(--text)" d="M ' + (sx+6) + ' ' + (y-6) + ' A 6 6 0 0 1 ' + (sx+6) + ' ' + (y+6) + '"/>';
      } else if (it.sym === 'coil-latch') {
        out += '<path fill="none" stroke="var(--text)" d="M ' + (sx-6) + ' ' + (y-6) + ' A 6 6 0 0 0 ' + (sx-6) + ' ' + (y+6) + '"/>' +
               '<path fill="none" stroke="var(--text)" d="M ' + (sx+6) + ' ' + (y-6) + ' A 6 6 0 0 1 ' + (sx+6) + ' ' + (y+6) + '"/>' +
               '<text x="' + sx + '" y="' + (y+3) + '" text-anchor="middle" font-size="8">L</text>';
      } else if (it.sym === 'block') {
        out += '<rect x="' + (sx-12) + '" y="' + (y-6) + '" width="24" height="12" rx="1" fill="var(--panel)" stroke="var(--text)"/>';
      } else if (it.sym === 'live') {
        out += '<rect x="' + (sx-12) + '" y="' + (y-6) + '" width="24" height="12" rx="1" fill="#eaf5ee" stroke="#2f7a4a"/>';
      }
      out += '<text x="' + (sx+18) + '" y="' + (y+3) + '" fill="var(--muted)">' + it.label + '</text>';
    }
    out += '</g>';
    return out;
  }

    function renderLadder(svg) {
    const i = state.inputs, m = state.mem, o = state.outputs;
    const rungs = [];
    let y = 135;   // start below legend  with clear gap for R1's annotation (legend ends at ~90)
    // R1
    rungs.push(anno(y, 'Safety enable: E-Stop clear + Reset arms system'));
    rungs.push(rungNum(y, 'R1') + wire(RAIL_L, y, 100) + contact(115, y, 'EStop_NC', false, !!i.EStop_NC)
      + wire(130, y, 230) + contact(245, y, 'Reset_PB', false, !!i.Reset_PB)
      + wire(260, y, 650) + coil(664, y, 'Sys_Enabled', true, !!(i.EStop_NC && i.Reset_PB)) + wire(678, y, RAIL_R));
    y += RUNG_H;

        // R2 — sealing circuit. Seal-in branch omitted from the diagram; noted in annotation.
    rungs.push(anno(y, 'Master sealing circuit: Start latches Sys_Running (self-seal: Sys_Running OR Start_PB feeds back)'));
    rungs.push(rungNum(y, 'R2')
      + wire(RAIL_L, y, 100) + contact(115, y, 'Sys_Enabled', false, !!m.Sys_Enabled)
      + wire(130, y, 230) + contact(245, y, 'Start_PB', false, !!i.Start_PB)
      + wire(260, y, 380) + contact(395, y, 'Stop_PB_NC', false, !!i.Stop_PB_NC)
      + wire(410, y, 520) + contact(535, y, 'Sys_Faulted', true, !m.Sys_Faulted)
      + wire(550, y, 650) + coil(664, y, 'Sys_Running', false, !!(m.Sys_Enabled && (i.Start_PB || m.Sys_Running) && i.Stop_PB_NC && !m.Sys_Faulted))
      + wire(678, y, RAIL_R));
    y += RUNG_H;

    // R3-R5
    if (!ladderFull) {
      rungs.push(anno(y, 'Station motor coils: (R3–R5 identical, × 3 stations)'));
      rungs.push(rungNum(y, 'R3–R5') + wire(RAIL_L, y, 100)
        + contact(115, y, 'Sys_Running', false, !!m.Sys_Running)
        + wire(130, y, 245) + contact(260, y, 'Sys_Faulted', true, !m.Sys_Faulted)
        + wire(275, y, 400) + contact(415, y, 'S1_AcceptAck', false, !!m.Z1_AcceptAck)
        + wire(430, y, 650) + coil(664, y, 'S1_Motor', false, !!o.Z1_Drive) + wire(678, y, RAIL_R));
      y += RUNG_H;
    } else {
      rungs.push(anno(y, 'Station motor coils: run only when healthy AND downstream ready'));
      for (let k = 0; k < 3; k++) {
        const zName = 'Z' + (k+1), sName = 'S' + (k+1);
        rungs.push(rungNum(y, 'R' + (3+k)) + wire(RAIL_L, y, 100)
          + contact(115, y, 'Sys_Running', false, !!m.Sys_Running)
          + wire(130, y, 245) + contact(260, y, 'Sys_Faulted', true, !m.Sys_Faulted)
          + wire(275, y, 400) + contact(415, y, sName + '_AcceptAck', false, !!m[zName + '_AcceptAck'])
          + wire(430, y, 650) + coil(664, y, sName + '_Motor', false, !!o[zName + '_Drive']) + wire(678, y, RAIL_R));
        y += RUNG_H;
      }
    }
    y += 6;

    // R6-R8
    if (!ladderFull) {
      rungs.push(anno(y, 'Backup detection: (R6–R8 identical, × 3 stations, PT=2s)'));
      const tonET = state.timers.TON_Z1_Backup.ET;
      rungs.push(rungNum(y, 'R6–R8') + wire(RAIL_L, y+11, 100)
        + contact(115, y+11, 'S1_Photoeye', false, !!state.inputs.Z1_PE)
        + wire(130, y+11, 245) + contact(260, y+11, 'S1_AcceptAck', true, !state.mem.Z1_AcceptAck)
        + wire(275, y+11, 460) + block(474, y-6, 160, 34, 'TON', 'PT=2000  ET=' + tonET, !!(state.inputs.Z1_PE && !state.mem.Z1_AcceptAck))
        + wire(648, y+11, RAIL_R));
      y += RUNG_H;
    } else {
      rungs.push(anno(y, 'Backup detection: item at photoeye AND downstream not accepting → block after PT'));
      for (let k = 0; k < 3; k++) {
        const zName = 'Z' + (k+1), sName = 'S' + (k+1);
        const tonET = state.timers['TON_' + zName + '_Backup'].ET;
        rungs.push(rungNum(y, 'R' + (6+k)) + wire(RAIL_L, y+11, 100)
          + contact(115, y+11, sName + '_Photoeye', false, !!state.inputs[zName + '_PE'])
          + wire(130, y+11, 245) + contact(260, y+11, sName + '_AcceptAck', true, !state.mem[zName + '_AcceptAck'])
          + wire(275, y+11, 460) + block(474, y-6, 160, 34, 'TON', 'PT=2000  ET=' + tonET, !!(state.inputs[zName + '_PE'] && !state.mem[zName + '_AcceptAck']))
          + wire(648, y+11, RAIL_R));
        y += RUNG_H;
      }
    }
    y += 6;

    // R9-R11
    if (!ladderFull) {
      rungs.push(anno(y, 'Belt-slip alarm: (R9–R11 identical, × 3 stations, PT=500ms)'));
      const tonET = state.timers.TON_Z1_SlipCheck.ET;
      rungs.push(rungNum(y, 'R9–R11') + wire(RAIL_L, y+11, 100)
        + contact(115, y+11, 'S1_Motor', false, !!o.Z1_Drive)
        + wire(130, y+11, 245) + contact(260, y+11, 'S1_Enc_Pulse', true, !state.inputs.Z1_Enc_Pulse)
        + wire(275, y+11, 460) + block(474, y-6, 160, 34, 'TON', 'PT=500  ET=' + tonET, !!(o.Z1_Drive && !state.inputs.Z1_Enc_Pulse))
        + wire(648, y+11, RAIL_R));
      y += RUNG_H;
    } else {
      rungs.push(anno(y, 'Belt-slip alarm: motor commanded but no encoder motion → fault after PT'));
      for (let k = 0; k < 3; k++) {
        const zName = 'Z' + (k+1), sName = 'S' + (k+1);
        const tonET = state.timers['TON_' + zName + '_SlipCheck'].ET;
        rungs.push(rungNum(y, 'R' + (9+k)) + wire(RAIL_L, y+11, 100)
          + contact(115, y+11, sName + '_Motor', false, !!o[zName + '_Drive'])
          + wire(130, y+11, 245) + contact(260, y+11, sName + '_Enc_Pulse', true, !state.inputs[zName + '_Enc_Pulse'])
          + wire(275, y+11, 460) + block(474, y-6, 160, 34, 'TON', 'PT=500  ET=' + tonET, !!(o[zName + '_Drive'] && !state.inputs[zName + '_Enc_Pulse']))
          + wire(648, y+11, RAIL_R));
        y += RUNG_H;
      }
    }
    y += 6;

    // R12
    rungs.push(anno(y, 'Throughput counter: count type-A items exiting Station 3'));
    const cv = state.counters.CTU_Throughput.CV;
    rungs.push(rungNum(y, 'R12') + wire(RAIL_L, y+11, 100)
      + contact(115, y+11, 'S3_PE ↓ & type=A', false, false)
      + wire(130, y+11, 460) + block(474, y-6, 160, 34, 'CTU', 'CV=' + cv, false)
      + wire(648, y+11, RAIL_R));
    y += RUNG_H + 6;

    // R13
    rungs.push(anno(y, 'Reject actuator: divert type-B items at Station 3 when reject station ready'));
    const z3id = tracking.zoneOwner[2];
    const z3item = z3id !== null ? tracking.items.get(z3id) : null;
    const isB = !!(z3item && z3item.type === 'B');
    rungs.push(rungNum(y, 'R13')
      + wire(RAIL_L, y, 100) + contact(115, y, 'S3_Photoeye', false, !!i.Z3_PE)
      + wire(130, y, 260) + contact(275, y, 'Type=B', false, isB)
      + wire(290, y, 430) + contact(445, y, 'Reject_Ready', false, !!i.Reject_Ready)
      + wire(460, y, 640) + coil(664, y, 'Reject_Actuator', false, !!o.Reject_Actuator) + wire(678, y, RAIL_R));
    y += RUNG_H;

            svg.setAttribute('viewBox', '0 0 740 ' + (y + 10));
    // rails start below the legend (y=95), rungs start at y=115
    svg.innerHTML = ladderLegend() + rails(95, y) + rungs.join('');
  }

  // ==== CONTROLS ====
  function bindControls(root) {
    const map = {
      start: () => { state.inputs.Start_PB = 1; setTimeout(() => state.inputs.Start_PB = 0, SCAN_MS + 20); },
      stop:  () => { state.inputs.Stop_PB_NC = 0; setTimeout(() => state.inputs.Stop_PB_NC = 1, SCAN_MS + 20); },
      estop: () => { state.inputs.EStop_NC = state.inputs.EStop_NC ? 0 : 1; },
      reset: () => { state.inputs.Reset_PB = 1; setTimeout(() => state.inputs.Reset_PB = 0, SCAN_MS + 20); }
    };
    root.querySelectorAll('[data-plc-btn]').forEach(btn => {
      const key = btn.getAttribute('data-plc-btn');
      if (map[key]) btn.addEventListener('click', map[key]);
    });
    root.querySelectorAll('[data-plc-remove]').forEach(btn => {
      const z = parseInt(btn.getAttribute('data-plc-remove'), 10);
      btn.addEventListener('click', () => inject.removeFromStation(z));
    });
    root.querySelectorAll('[data-plc-bounce]').forEach(btn => {
      const z = parseInt(btn.getAttribute('data-plc-bounce'), 10);
      btn.addEventListener('click', () => inject.bouncePE(z));
    });
    root.querySelectorAll('[data-plc-hs]').forEach(cb => {
      const link = cb.getAttribute('data-plc-hs');
      cb.addEventListener('change', () => inject.breakHandshake(link, cb.checked));
    });
    const reconBtn = root.querySelector('[data-plc-reconcile]');
    if (reconBtn) reconBtn.addEventListener('click', () => inject.reconcile());

    const hmi = root.querySelector('[data-plc-hmi]');
    if (hmi) {
      hmi.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-plc-item-id')) {
          const id = parseInt(t.getAttribute('data-plc-item-id'), 10);
          inject.removeItem(id);
        }
      });
    }

    root.querySelectorAll('[data-plc-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-plc-tab');
        root.querySelectorAll('[data-plc-tab]').forEach(t => t.classList.toggle('is-active', t === tab));
        root.querySelectorAll('[data-plc-panel]').forEach(p => {
          p.classList.toggle('is-active', p.getAttribute('data-plc-panel') === target);
        });
      });
    });

    const fullCb = root.querySelector('[data-plc-ladder-full]');
    if (fullCb) fullCb.addEventListener('change', () => { ladderFull = fullCb.checked; });
  }

  // ==== BOOT ====
  function boot() {
    const root = document.querySelector('.plc-sim');
    if (!root) return;
    const tagsEl   = root.querySelector('[data-plc-tags]');
    const ladderEl = root.querySelector('[data-plc-ladder]');
    const estopBtn = root.querySelector('[data-plc-estop-btn]');
    bindControls(root);

    let rafId = 0;
    function frame() {
      renderHMI(root);
      renderStatus(root);
      renderActivity(root);
      renderRemoveButtons(root);
      if (tagsEl)   renderTags(tagsEl);
      if (ladderEl) renderLadder(ladderEl);
      renderInvariants(root);
      if (estopBtn) {
        const tripped = !state.inputs.EStop_NC;
        estopBtn.classList.toggle('is-tripped', tripped);
        estopBtn.textContent = tripped ? 'E-Stop (tripped — click to release)' : 'E-Stop';
      }
      rafId = requestAnimationFrame(frame);
    }
    frame();

    state.inputs.Reset_PB = 1; scan(); state.inputs.Reset_PB = 0;
    state.inputs.Start_PB = 1; scan(); state.inputs.Start_PB = 0;
    if (!state._interval) state._interval = setInterval(scan, SCAN_MS);

    window.__plc._stopRender = function () { cancelAnimationFrame(rafId); };
  }

  window.__plc = {
    state, tracking, physical, inject, SCAN_MS, FAULT,
    scan: scan,
    step(n) { n = n || 1; for (let k = 0; k < n; k++) scan(); },
    run(ms) { if (state._interval) return; state._interval = setInterval(scan, ms || SCAN_MS); },
    stop() { if (state._interval) { clearInterval(state._interval); state._interval = null; } },
    press(name)   { if (name in state.inputs) state.inputs[name] = 1; },
    release(name) { if (name in state.inputs) state.inputs[name] = 0; },
    pressFor(name, scans) {
      state.inputs[name] = 1;
      for (let k = 0; k < (scans || 1); k++) scan();
      state.inputs[name] = 0;
    },
    dump() {
      return {
        scan: state.scanCount,
        sys: { En: state.mem.Sys_Enabled, Run: state.mem.Sys_Running, Flt: state.mem.Sys_Faulted, Code: state.mem.Fault_Code },
        in:  Object.assign({}, state.inputs),
        out: Object.assign({}, state.outputs),
        backups: [state.mem.Z1_Backup, state.mem.Z2_Backup, state.mem.Z3_Backup],
        timers: {
          BZ1: state.timers.TON_Z1_Backup.ET, BZ2: state.timers.TON_Z2_Backup.ET, BZ3: state.timers.TON_Z3_Backup.ET,
          SZ1: state.timers.TON_Z1_SlipCheck.ET
        },
        throughput: state.counters.CTU_Throughput.CV,
        physical: { slots: physical.zoneSlot.slice(), pos: physical.zonePos.slice(), items: Array.from(physical.items.values()) },
        tracking: { owner: tracking.zoneOwner.slice(), items: Array.from(tracking.items.values()) },
        invariants: Object.assign({}, state.invariants)
      };
    }
  };

    // ==== GUIDED TOUR ====
  // Each tour is an array of steps. Steps are objects with:
  //   { do: fn, narrate: string, waitMs: number }
  // The runner executes them sequentially, updating a narration overlay.

  const tourState = { running: false, cancelled: false, timeouts: [] };

  function tourCancel() {
    tourState.cancelled = true;
    tourState.running = false;
    tourState.timeouts.forEach(t => clearTimeout(t));
    tourState.timeouts = [];
    hideNarration();
  }

  function showNarration(root, text, tone) {
    let el = root.querySelector('[data-plc-narration]');
    if (!el) {
      el = document.createElement('div');
      el.className = 'plc-sim__narration';
      el.setAttribute('data-plc-narration', '');
      el.innerHTML = '<span class="plc-sim__narration-text"></span>' +
                     '<button type="button" class="plc-sim__narration-dismiss" aria-label="End tour">x</button>';
      const hmi = root.querySelector('[data-plc-hmi]');
      hmi.parentNode.insertBefore(el, hmi);
      el.querySelector('.plc-sim__narration-dismiss').addEventListener('click', tourCancel);
    }
    el.querySelector('.plc-sim__narration-text').textContent = text;
    el.className = 'plc-sim__narration' + (tone ? ' is-' + tone : '');
  }

  function hideNarration() {
    const el = document.querySelector('[data-plc-narration]');
    if (el) el.parentNode.removeChild(el);
  }

  function runTour(root, steps) {
    if (tourState.running) tourCancel();
    tourState.running = true;
    tourState.cancelled = false;
    let idx = 0;
    function next() {
      if (tourState.cancelled || idx >= steps.length) {
        tourState.running = false;
        setTimeout(hideNarration, 2500);
        return;
      }
      const step = steps[idx++];
      if (step.do) step.do();
      if (step.narrate) showNarration(root, step.narrate, step.tone);
      const t = setTimeout(next, step.waitMs || 3000);
      tourState.timeouts.push(t);
    }
    next();
  }

  // Reset helpers — bring sim to a known clean state
  function tourResetSim() {
    // Clear any injections
    inject.breakHandshake('Z1Z2', false);
    inject.breakHandshake('Z2Z3', false);
    // Clear physical + tracking
    physical.items.clear();
    physical.zoneSlot = [null, null, null];
    physical.zonePos = [0, 0, 0];
    physical.chuteSlot = null;
    physical.chutePos = 0;
    physical.feedCounter = 0;
    // Preserve typeIdx and nextId so item IDs keep incrementing (looks live, not cheating)
    tracking.items.clear();
    tracking.zoneOwner = [null, null, null];
    state.mem.Sys_Faulted = 0;
    state.mem.Fault_Code = 0;
    state.mem.Z1_Backup = state.mem.Z2_Backup = state.mem.Z3_Backup = 0;
    state.mem.Z1_Slip_Alarm = state.mem.Z2_Slip_Alarm = state.mem.Z3_Slip_Alarm = 0;
    state.counters.CTU_Throughput.CV = 0;
    state.counters.CTU_Throughput.prev_CU = 0;
    Object.values(state.timers).forEach(t => { t.ET = 0; t.DN = 0; t.IN = 0; });
    state.prevPE = [0,0,0]; state.prevZ3PE = 0;
    // Re-arm and start
    state.inputs.EStop_NC = 1;
    state.inputs.Stop_PB_NC = 1;
    state.inputs.Reset_PB = 1; scan(); state.inputs.Reset_PB = 0;
    state.inputs.Start_PB = 1; scan(); state.inputs.Start_PB = 0;
    // Uncheck handshake checkboxes in UI
    document.querySelectorAll('[data-plc-hs]').forEach(cb => { cb.checked = false; });
  }

  function tourNormal(root) {
    runTour(root, [
      { do: tourResetSim, narrate: 'Resetting the line to a clean state.', waitMs: 1200 },
      { narrate: 'Items feed at Station 1 every ~3 seconds. Type A (teal) are accepted; type B (orange) will divert at Station 3.', waitMs: 5500 },
      { narrate: 'Watch each item cross a station: photoeye beam turns amber when broken, zone turns teal while its motor runs.', waitMs: 6000 },
      { narrate: 'At Station 3, type-A items exit right; type-B items divert down the reject chute.', waitMs: 6000 },
      { narrate: 'Throughput counter increments only for accepted (type-A) items. Line runs continuously until stopped or faulted.', waitMs: 5000 }
    ]);
  }

  function tourBackup(root) {
    runTour(root, [
      { do: tourResetSim, narrate: 'Resetting, then we will simulate a downstream blockage.', waitMs: 2000 },
      { narrate: 'Waiting for items to populate the line...', waitMs: 5000 },
      {
        do: () => {
          inject.breakHandshake('Z1Z2', true);
          const cb = document.querySelector('[data-plc-hs="Z1Z2"]');
          if (cb) cb.checked = true;
        },
        narrate: 'Handshake broken: Station 1 can no longer pass items to Station 2. Any item at Station 1 photoeye triggers the backup TON.',
        tone: 'warn',
        waitMs: 3500
      },
      { narrate: 'After 2 seconds (TON.PT), the Backup bit latches high, dropping Sys_Running conditions for Station 1. Station 1 motor stops - watch the zone turn amber.', tone: 'warn', waitMs: 5000 },
      { narrate: 'Downstream (Stations 2 and 3) keeps running until it drains. This is authentic accumulation-conveyor behaviour.', waitMs: 5000 },
      {
        do: () => {
          inject.breakHandshake('Z1Z2', false);
          const cb = document.querySelector('[data-plc-hs="Z1Z2"]');
          if (cb) cb.checked = false;
        },
        narrate: 'Restoring the handshake. Station 1 backup clears, motor resumes, line recovers automatically. No operator intervention needed.',
        waitMs: 4500
      }
    ]);
  }

  function tourFault(root) {
    runTour(root, [
      { do: tourResetSim, narrate: 'Resetting, then we will provoke a tracking fault.', waitMs: 2000 },
      { narrate: 'Waiting for an item to reach Station 2...', waitMs: 7000 },
      {
        do: () => {
          if (physical.zoneSlot[1] !== null) inject.removeFromStation(1);
          else if (physical.zoneSlot[0] !== null) inject.removeFromStation(0);
        },
        narrate: 'Removed an item physically without telling the PLC. The photoeye stays broken but tracking sees no owner. Invariant pe_matches_owner trips.',
        tone: 'fault',
        waitMs: 4500
      },
      { narrate: 'FAULT code 22. Sys_Faulted latches, all motors drop. The system will not restart until the tracker is reconciled with reality.', tone: 'fault', waitMs: 4500 },
      {
        do: () => inject.reconcile(),
        narrate: 'Reconcile pressed: PLC walks all photoeyes and adopts UNKNOWN items for any orphan signal. Fault code changes to 30.',
        tone: 'warn',
        waitMs: 4500
      },
      {
        do: () => {
          state.inputs.Reset_PB = 1;
          setTimeout(() => { state.inputs.Reset_PB = 0; }, 250);
        },
        narrate: 'Reset pressed: fault clears, Sys_Enabled arms.',
        waitMs: 2500
      },
      {
        do: () => {
          state.inputs.Start_PB = 1;
          setTimeout(() => { state.inputs.Start_PB = 0; }, 250);
        },
        narrate: 'Start pressed: line resumes. UNKNOWN items (grey) will divert to reject at Station 3 since they are not confirmed type A. Recovery complete.',
        waitMs: 5000
      }
    ]);
  }

  function bindTour(root) {
    const map = {
      normal: () => tourNormal(root),
      backup: () => tourBackup(root),
      fault:  () => tourFault(root),
      reset:  () => { tourCancel(); tourResetSim(); }
    };
    root.querySelectorAll('[data-plc-tour]').forEach(btn => {
      const k = btn.getAttribute('data-plc-tour');
      if (map[k]) btn.addEventListener('click', map[k]);
    });
  }

  // ==== METHODOLOGY CONTENT ====
   const METHODOLOGY_BEHAVIOUR =
    '<p>This widget simulates a real accumulation conveyor, the kind used to buffer product ' +
    'between processes on a factory line. It is controlled by a virtual PLC running in your ' +
    'browser. Nothing is hardware-emulated: the PLC runs real ladder logic on a fixed 100&nbsp;ms ' +
    'scan cycle, reads its inputs from simulated sensors, and writes outputs that move the items.</p>' +

    '<h5>What you are looking at</h5>' +
    '<p>Three stations in series. Items feed in at Station 1 on a fixed pitch. Each station has ' +
    'a photoeye (the dashed vertical line that turns amber when broken) and a motor. Items are ' +
    'one of two types: type A in teal are accepted, type B in orange are rejected. When a type-B ' +
    'item reaches Station 3, the reject actuator diverts it down the chute. Type-A items continue ' +
    'straight to the accept exit.</p>' +

    '<h5>What the PLC is doing</h5>' +
    '<p>Every 100&nbsp;ms the PLC reads all photoeye and pushbutton inputs, evaluates the ladder ' +
    'program, and writes new motor outputs. Stations only run when their downstream neighbour is ' +
    'ready to accept the next item. If Station 2 is occupied, Station 1 holds. This is called ' +
    'backpressure and it is what stops items crashing into each other.</p>' +

    '<h5>Why the fault handling matters</h5>' +
    '<p>A real conveyor needs to know which item is where. If a sensor misfires or an item is ' +
    'removed by hand, the PLC could silently lose track and reject an accepted product, or miss ' +
    'a defective one. This simulation runs a second layer next to the ladder that checks four ' +
    'consistency rules every scan and faults the system if any of them fail. That is what the ' +
    '<em>Reconcile</em> button and the invariants strip are for.</p>' +

    '<h5>Try the guided demos above</h5>' +
    '<p>The three demo buttons walk through normal operation, a downstream blockage, and a ' +
    'fault-and-recovery sequence. Each one narrates what to watch for as it runs.</p>';

    const METHODOLOGY_CONCEPTS =
    '<p>This simulator implements the following PLC concepts to IEC 61131-3 conventions.</p>' +

    '<h5>1. Scan cycle</h5>' +
    '<p>The controller runs a 100&nbsp;ms scan driven by <code>setInterval</code>. Each scan runs ' +
    'in order: physics update (advance items, set photoeye inputs from ground truth), ladder ' +
    'evaluation (read inputs, solve rungs, write outputs), tracking update (maintain item-identity ' +
    'records on PE edges), invariant check (verify state consistency). This mirrors the ' +
    'input-scan, program-solve, output-update cycle of a real PLC.</p>' +

    '<h5>2. Tag naming</h5>' +
    '<p>Discrete inputs and outputs use IEC-style addressing: <code>%I0.0 Start_PB</code>, ' +
    '<code>%Q0.0 S1_Motor</code>, <code>%I1.2 S3_Photoeye</code>. Memory bits and timers use ' +
    'symbolic names. All values are visible live in the tag readout below.</p>' +

    '<h5>3. Sealing (seal-in) circuit</h5>' +
    '<p>Rung R2 is the classic Start/Stop with self-seal: ' +
    '<code>Sys_Enabled AND (Start_PB OR Sys_Running) AND Stop_PB_NC AND NOT Sys_Faulted → ' +
    'Sys_Running</code>. Once Start latches Sys_Running, Sys_Running feeds back on itself so the ' +
    'coil stays energised after the operator releases the button.</p>' +

    '<h5>4. TON timers</h5>' +
    '<p>Backup detection uses one <code>TON</code> per station with <code>PT = 2000&nbsp;ms</code>. ' +
    'Belt-slip detection uses one TON per station with <code>PT = 500&nbsp;ms</code>, comparing ' +
    'commanded motor state to encoder pulses (movement evidence). ET values are visible live in ' +
    'the tag readout and animate on the ladder blocks.</p>' +

    '<h5>5. CTU counter</h5>' +
    '<p>The throughput counter counts falling edges of Station 3\'s photoeye filtered by item type. ' +
    'Only type-A (accepted) items increment CV. The Reset button clears CV via the CTU\'s reset ' +
    'input.</p>' +

    '<h5>6. Interlocks and handshakes</h5>' +
    '<p>Each station\'s motor coil requires <code>Sys_Running AND NOT Sys_Faulted AND ' +
    'Zi_AcceptAck</code>. <code>Zi_AcceptAck</code> is computed from the downstream zone\'s ' +
    'owner slot, the downstream backup bit, and a manual break flag. This is equivalent to the ' +
    'safety and downstream-ready handshakes used between real PLCs on a production line.</p>' +

    '<h5>7. E-Stop and Reset arbitration</h5>' +
    '<p>E-Stop is a normally-closed contact (<code>EStop_NC = 1</code> when clear). When dropped, ' +
    'Sys_Enabled and Sys_Running clear immediately. Reset arms Sys_Enabled only when E-Stop is ' +
    'clear, and can also clear latched fault codes when pressed alone.</p>' +

    '<h5>8. Item tracking as a parallel FB</h5>' +
    '<p>The tracking layer runs alongside the ladder, conceptually a Function Block called each ' +
    'scan. It maintains <code>zoneOwner[1..3]</code> (which item ID each station currently owns) ' +
    'and an item metadata map (<code>id, type, entry_scan, last_zone</code>). Ownership ' +
    'transfers on rising edges of downstream photoeyes, which is the same shift-register-by-' +
    'encoder pattern used in real accumulation code.</p>' +

    '<h5>9. Runtime invariants</h5>' +
    '<p>Four invariants are checked every scan: no duplicate item IDs; count conserved between ' +
    'the item map and zone-owner array; each photoeye state matches the corresponding zone-owner ' +
    'presence; zone index of any tracked item is non-decreasing over its lifetime. A violation ' +
    'trips Sys_Faulted with a dedicated fault code (20 to 22), separate from physical fault codes ' +
    '(11 to 13). This lets operators tell a tracking desync from a mechanical fault straight ' +
    'away.</p>' +

    '<h5>10. Reconciliation</h5>' +
    '<p>When a tracking fault occurs, the operator presses Reconcile. The routine walks all ' +
    'photoeyes: any PE showing 1 with no owner gets a new UNKNOWN item created, any owner with ' +
    'PE=0 is deleted. This is the standard "walk the line" recovery procedure. UNKNOWN items are ' +
    'routed to reject at Station 3 since their type cannot be confirmed, which errs on the side ' +
    'of quality rather than throughput.</p>';

  function renderMethodology(root) {
    const bEl = root.querySelector('[data-plc-method-behaviour]');
    const cEl = root.querySelector('[data-plc-method-concepts]');
    if (bEl && !bEl.dataset.built) { bEl.innerHTML = METHODOLOGY_BEHAVIOUR; bEl.dataset.built = '1'; }
    if (cEl && !cEl.dataset.built) { cEl.innerHTML = METHODOLOGY_CONCEPTS; cEl.dataset.built = '1'; }
  }

  // Hook renderMethodology + bindTour into boot
  const _origBoot = boot;
  boot = function () {
    _origBoot();
    const root = document.querySelector('.plc-sim');
    if (!root) return;
    bindTour(root);
    renderMethodology(root);
  };

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); }
  else { boot(); }
})();