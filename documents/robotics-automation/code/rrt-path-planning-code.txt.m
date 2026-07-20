clc;
clear all;
%% Sect 1 - Laying out the floor plan
load exampleMaps.mat
whos *Map*
% Select map & resolution
map = binaryOccupancyMap(complexMap,2);
robotRadius = 0.2;
inflateRadius = 0.1;
mapInflated = copy(map);
inflate(mapInflated,inflateRadius);
% Adding obstacles
x = [12.0; 16.5; 10.0; 13.0; 23.0];
y = [8.0; 9.0; 5.0; 2.0; 12.0];
% Visualising map
setOccupancy(map, [x y], ones(5,1))
show(mapInflated)

%% Sect 2 - StateSpaceDubbins
% Create a state space object for Dubins vehicle
stateSpace = stateSpaceDubins;
sv = validatorOccupancyMap(stateSpace);
sv.Map = map;
% Define turning radius
turningRadius = 0.1; % meters
% Define state bounds [x_min, x_max; y_min, y_max; theta_min, theta_max]
stateBounds = [0, 24; 0, 22; -pi, pi];
% Set state bounds for the state space object
stateSpace.StateBounds = stateBounds;
%% Sect 3 - RRT Programme
% Start and end goals
start = [2,2,0];
goal = [24,15,0];
% Change MaxConnectDistance, if lots of collisions
planner = plannerRRT(stateSpace,sv,MaxConnectionDistance=0.2);
rng(100,'twister'); % for repeatable result
[pthObj,solnInfo] = plan(planner,start,goal);
MaxIterations = 1000;
show(map)
grid on;
title('Office Floor Plan')
hold on
% Tree expansion
plot(solnInfo.TreeData(:,1),solnInfo.TreeData(:,2),'.-')
% Draw path
plot(pthObj.States(:,1),pthObj.States(:,2),'r-','LineWidth',2)
