# FlowState

FlowState is an interactive workflow builder that allows users to visually create logic flows using a node-based interface.

## Preview

Add screenshot here:

```md
![FlowState workflow builder preview](./path-to-screenshot.png)
```

## Screen Recording

Add screen recording here:

```md
https://github.com/user-attachments/assets/your-recording-id
```

Or, if the recording is committed to the repo:

```md
https://github.com/oliverjayden20/FlowState/assets/path-to-demo-video.mp4
```

## Features

- Drag-and-drop node system
- Visual workflow connections
- Circuit-style execution preview
- Delay nodes that hold outgoing workflow signals
- Node configuration panel
- Workflow validation states
- Collapsible side panels
- Command palette and keyboard shortcuts
- Local save/load and JSON import/export

## Tech Stack

- React
- React Flow
- Tailwind CSS
- Framer Motion
- Vite

## File Structure

```text
Flow_State/
├── .gitignore
├── README.md
├── eslint.config.js
├── index.html
├── package-lock.json
├── package.json
├── vite.config.js
├── public/
│   ├── favicon.svg
│   └── icons.svg
└── src/
    ├── App.jsx
    ├── index.css
    ├── main.jsx
    └── assets/
        ├── hero.png
        ├── react.svg
        └── vite.svg
```

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
