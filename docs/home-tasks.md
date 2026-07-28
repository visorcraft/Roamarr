<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Home tasks

Home tasks track work before departure, such as holding mail or watering
plants.

## Fields and behavior

- required task text;
- optional due date;
- done flag;
- trip ownership link.

Tasks are trip-specific and do not recur or copy automatically.

## Current access

The server has trip-page actions, but the current **Prep** panel does not
render home-task controls. Use an OAuth/MCP client:

- `roamarr_home_task_list`;
- `roamarr_home_task_create`;
- `roamarr_home_task_toggle_done`;
- `roamarr_home_task_delete`.

Write operations require edit access. The list tool accepts a viewable trip
when the client has `home-tasks:read`. Deletion requires `confirm: true`.

Home tasks are excluded from public links and calendar feeds. Task text may
reveal home absence or security information, so share and scope it carefully.
