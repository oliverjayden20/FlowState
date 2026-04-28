# FlowState

FlowState is a polished visual workflow builder built with React, React Flow, Tailwind CSS, and Framer Motion. It focuses on frontend interaction quality: graph editing, circuit-style execution, validation, animations, command-driven controls, and local workflow persistence.

## Features

- Drag-and-drop node library for Start, API Call, Delay, Condition, Transform, and Output nodes
- React Flow canvas with pan, zoom, minimap, snapping, custom nodes, and animated edges
- Circuit-style workflow execution where nodes fire only after required incoming signals arrive
- Delay nodes hold outgoing signals for the configured amount before downstream execution continues
- `WAITING`, `DELAYING`, `RUNNING`, and `COMPLETE` visual states
- Workflow validation with blocking errors, warnings, and node badges
- Node inspector with type-specific editable configuration
- Local save/load, JSON export/import, workflow templates, and clean auto-layout
- Command palette and keyboard shortcuts for editor-grade workflows

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

## Useful Scripts

```bash
npm run lint
npm run build
```

## Demo Checklist

1. Load a template from the sidebar.
2. Drag a node from the library onto the canvas.
3. Connect nodes by dragging from one handle to another.
4. Select a node and edit its properties in the inspector.
5. Run the workflow and watch signals move through the graph.
6. Add a Delay branch and confirm downstream nodes wait for the delayed signal.
7. Press `Ctrl+K` to open the command palette.
8. Save, reset, then load the workflow from local storage.
9. Export JSON, reset the canvas, then import the JSON again.
10. Press `L` or click Layout to clean up the graph.
