# Specification

This is a animated interactive visualization built using Svelte 5 of the paper [egg: Fast and Extensible Equality Saturation](./egraphs-good.pdf).

## Features
 - Multi-Pane View
   - **Graph Pane**
   - **State Pane**
     - Hashcons (list of e-nodes mapped to node id)
     - e-class map (canonical e-node ids map to lists e-node structures)
     - Union find (lists of e-nodes-ids mapping to the canonical one)
   - **Controller & Preset Selector**

### Data model

 - NodeID
   - `op: string` op name
   - `args: number[]` list of arguments of node-ids
 - 

 - Hashcons - JS object mapping numbers to 

### Graph Pane

A self-organizing graph of e-classes each containing e-nodes with arrows pointing
 - Use Svelte Flow.
   - Use ELK for layout with incremental editing.
   - TODO: Figure best layout algorithm for this.
 - TODO: See if this supports animation (e.g. for egraph merging)

### State Pane

The state pane (right side of the app) will contain a scrollable view with the sections below.

The basic components of these sections are as follows. Some of these come in an active and inactive mode.
 - A e-node ID, a colored diamong containing a number. Can have a yellow star in the top right to denote it being a canonical node id (defined by the current state of the union-find).
   - The color of the box is a random hue seeded by the e-node-id number.
 - A e-node renders as a symbol, e.g. '*', '/' 'add', '2', 'a', and 0 or more e-node ids enclosed in parentheses (if 0 associated e-nodes, there are no parens)
   - These render in a transparent box with rounded corners.
   - Active: black, with white background, Inactive: dark grey stroke and lighter grey background.
 - An e-class is a box inline list of e-nodes.
   - The box is transparent and has dotted lines around it.
   - Active: black, Inactive: grey
 - An arrow maps one of the components here to another.
   - Active: black, Inactive: grey.
   - Activeness for arrows depend on the view.
     - Hashcons: if 

#### Hashcons View

This section contains a list of arrow components mapping e-nodes to their associated e-node ids. The e-nodes are just text in a box, the e-node ids are numbers in a box colored uniquely based on the number for ease of visualization.

#### E-class map

This is just a block list of canonical e-node-ids (e.g. e-class-ids) to boxes that contain e-nodes.