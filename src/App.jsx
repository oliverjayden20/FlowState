import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Binary,
  Braces,
  Check,
  ChevronDown,
  CircleDot,
  Clock3,
  Command,
  Copy,
  DatabaseZap,
  Download,
  FileJson,
  GitBranch,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  Play,
  PlugZap,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'

const STORAGE_KEY = 'flowstate.workflow.v1'
const IMPORT_INPUT_ID = 'flowstate-import-input'
const BASE_NODE_RUN_MS = 660
const NODE_GAP_MS = 240
const MAX_SIMULATED_DELAY_MS = 10000

const nodeCatalog = [
  {
    type: 'start',
    label: 'Start',
    description: 'Entry point',
    icon: CircleDot,
    color: '#22c55e',
    defaults: { trigger: 'Manual trigger', retries: 0 },
  },
  {
    type: 'api',
    label: 'API Call',
    description: 'Fetch external data',
    icon: PlugZap,
    color: '#38bdf8',
    defaults: { url: 'https://api.example.com/events', method: 'GET', timeout: 30 },
  },
  {
    type: 'delay',
    label: 'Delay',
    description: 'Wait before next step',
    icon: Clock3,
    color: '#f59e0b',
    defaults: { duration: 5, unit: 'seconds' },
  },
  {
    type: 'condition',
    label: 'Condition',
    description: 'Branch with rules',
    icon: GitBranch,
    color: '#a855f7',
    defaults: { field: 'status', operator: 'equals', value: 'active' },
  },
  {
    type: 'transform',
    label: 'Transform',
    description: 'Shape payload',
    icon: Braces,
    color: '#2dd4bf',
    defaults: { mode: 'Map fields', expression: 'return payload.data' },
  },
  {
    type: 'output',
    label: 'Output',
    description: 'Send result',
    icon: Send,
    color: '#fb7185',
    defaults: { channel: 'Slack', target: '#alerts' },
  },
]

const catalogByType = Object.fromEntries(nodeCatalog.map((node) => [node.type, node]))

const initialNodes = [
  makeNode('node-1', 'start', 'Start', 80, 120),
  makeNode('node-2', 'api', 'Fetch API', 360, 120),
  makeNode('node-3', 'transform', 'Transform Data', 640, 120),
  makeNode('node-4', 'condition', 'Condition', 920, 120),
  makeNode('node-5', 'output', 'Send Alert', 1200, 120),
]

const initialEdges = [
  createEdge('node-1', 'node-2'),
  createEdge('node-2', 'node-3'),
  createEdge('node-3', 'node-4'),
  createEdge('node-4', 'node-5'),
]

const templates = [
  {
    name: 'API to Alert',
    description: 'Fetch, transform, branch, notify',
    nodes: initialNodes,
    edges: initialEdges,
  },
  {
    name: 'Webhook Filter',
    description: 'Receive, validate, delay, output',
    nodes: [
      makeNode('node-1', 'start', 'Webhook Received', 120, 160),
      makeNode('node-2', 'condition', 'Validate Payload', 420, 80),
      makeNode('node-3', 'delay', 'Cooldown', 720, 80),
      makeNode('node-4', 'output', 'Forward Event', 1020, 160),
    ],
    edges: [createEdge('node-1', 'node-2'), createEdge('node-2', 'node-3'), createEdge('node-3', 'node-4')],
  },
  {
    name: 'Lead Enrichment',
    description: 'Fetch profile, normalize, sync',
    nodes: [
      makeNode('node-1', 'start', 'New Lead', 120, 120),
      makeNode('node-2', 'api', 'Enrich Company', 420, 120),
      makeNode('node-3', 'transform', 'Normalize Fields', 720, 120),
      makeNode('node-4', 'output', 'Sync CRM', 1020, 120),
    ],
    edges: [createEdge('node-1', 'node-2'), createEdge('node-2', 'node-3'), createEdge('node-3', 'node-4')],
  },
]

function makeNode(id, type, label, x, y) {
  return {
    id,
    type: 'workflow',
    position: { x, y },
    data: buildNodeData(type, label),
  }
}

function buildNodeData(type, label) {
  const item = catalogByType[type]
  return {
    nodeType: type,
    label,
    description: item.description,
    color: item.color,
    config: { ...item.defaults },
    status: 'idle',
    warnings: [],
  }
}

function createEdge(source, target) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type: 'smoothstep',
    animated: true,
    data: { status: 'idle' },
    style: { stroke: '#38bdf8', strokeWidth: 2.4 },
  }
}

function App() {
  return (
    <ReactFlowProvider>
      <FlowStateApp />
    </ReactFlowProvider>
  )
}

function FlowStateApp() {
  const runTimerRef = useRef([])
  const nodeIdRef = useRef(initialNodes.length + 1)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [logs, setLogs] = useState([
    { id: 'boot', level: 'info', text: 'Canvas ready. Drag nodes from the library to build a workflow.' },
  ])
  const [toasts, setToasts] = useState([])
  const [isRunning, setIsRunning] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')

  const validation = useMemo(() => validateWorkflow(nodes, edges), [nodes, edges])
  const nodeWarnings = useMemo(() => {
    const grouped = new Map()
    validation.issues.forEach((issue) => {
      if (!issue.nodeId) return
      grouped.set(issue.nodeId, [...(grouped.get(issue.nodeId) ?? []), issue.message])
    })
    return grouped
  }, [validation.issues])

  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: { ...node.data, warnings: nodeWarnings.get(node.id) ?? [] },
      })),
    [nodeWarnings, nodes],
  )

  const displayEdges = useMemo(() => decorateEdges(edges, nodes), [edges, nodes])

  const selectedNode = useMemo(
    () => displayNodes.find((node) => node.id === selectedNodeId) ?? null,
    [displayNodes, selectedNodeId],
  )

  const nodeTypes = useMemo(() => ({ workflow: WorkflowNode }), [])

  const pushToast = useCallback((tone, title, text) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((current) => [{ id, tone, title, text }, ...current.slice(0, 2)])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 3300)
  }, [])

  const addLog = useCallback((level, text) => {
    setLogs((current) => [{ id: `${Date.now()}-${Math.random()}`, level, text }, ...current.slice(0, 27)])
  }, [])

  const clearRunTimers = useCallback(() => {
    runTimerRef.current.forEach((timerId) => window.clearTimeout(timerId))
    runTimerRef.current = []
  }, [])

  const normalizeEdges = useCallback((nextEdges) => nextEdges.map((edge) => styleEdge(edge, 'idle')), [])

  const openImportPicker = useCallback(() => {
    document.getElementById(IMPORT_INPUT_ID)?.click()
  }, [])

  const loadGraph = useCallback(
    (nextNodes, nextEdges, message) => {
      clearRunTimers()
      setIsRunning(false)
      setNodes(nextNodes.map((node) => ({ ...node, data: { ...node.data, status: 'idle' } })))
      setEdges(normalizeEdges(nextEdges))
      setSelectedNodeId(null)
      nodeIdRef.current = getNextNodeId(nextNodes)
      addLog('success', message)
      pushToast('success', 'Workflow loaded', message)
      window.requestAnimationFrame(() => fitView({ padding: 0.18, duration: 420 }))
    },
    [addLog, clearRunTimers, fitView, normalizeEdges, pushToast, setEdges, setNodes],
  )

  const onConnect = useCallback(
    (connection) => {
      const nextEdge = styleEdge({ ...connection, id: `${connection.source}-${connection.target}` }, 'idle')
      setEdges((current) => addEdge(nextEdge, current))
      addLog('success', `Connected ${connection.source} to ${connection.target}.`)
    },
    [addLog, setEdges],
  )

  const onDragStart = (event, item) => {
    event.dataTransfer.setData('application/reactflow', item.type)
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const addNode = useCallback(
    (type, position) => {
      if (!catalogByType[type]) return
      const item = catalogByType[type]
      const id = `node-${nodeIdRef.current++}`
      const newNode = {
        id,
        type: 'workflow',
        position,
        data: buildNodeData(type, item.label),
      }
      setNodes((current) => current.concat(newNode))
      setSelectedNodeId(id)
      addLog('info', `Added ${item.label} node to the canvas.`)
      pushToast('info', 'Node added', `${item.label} is ready to configure.`)
    },
    [addLog, pushToast, setNodes],
  )

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow')
      addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [addNode, screenToFlowPosition],
  )

  const onSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    setSelectedNodeId(selectedNodes[0]?.id ?? null)
  }, [])

  const updateSelectedNode = useCallback(
    (patch) => {
      if (!selectedNodeId) return
      setNodes((current) =>
        current.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...patch,
                  config: patch.config ? { ...node.data.config, ...patch.config } : node.data.config,
                },
              }
            : node,
        ),
      )
    },
    [selectedNodeId, setNodes],
  )

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId))
    setEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId))
    setSelectedNodeId(null)
    addLog('info', 'Deleted selected node.')
  }, [addLog, selectedNodeId, setEdges, setNodes])

  const layoutWorkflow = useCallback(() => {
    setNodes((current) => autoLayoutNodes(current, edges))
    addLog('success', 'Applied clean circuit layout.')
    pushToast('success', 'Layout cleaned', 'Nodes were arranged into readable execution lanes.')
    window.requestAnimationFrame(() => fitView({ padding: 0.18, duration: 420 }))
  }, [addLog, edges, fitView, pushToast, setNodes])

  const duplicateSelectedNode = useCallback(() => {
    const source = nodes.find((node) => node.id === selectedNodeId)
    if (!source) return
    const id = `node-${nodeIdRef.current++}`
    const copy = {
      ...source,
      id,
      selected: false,
      position: { x: source.position.x + 60, y: source.position.y + 70 },
      data: { ...source.data, label: `${source.data.label} Copy`, status: 'idle' },
    }
    setNodes((current) => current.concat(copy))
    setSelectedNodeId(id)
    addLog('info', `Duplicated ${source.data.label}.`)
  }, [addLog, nodes, selectedNodeId, setNodes])

  const resetWorkflow = useCallback(() => {
    loadGraph(initialNodes, initialEdges, 'Workflow reset to the default pipeline.')
  }, [loadGraph])

  const saveWorkflow = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges: normalizeEdges(edges), savedAt: new Date().toISOString() }))
    addLog('success', 'Saved workflow to local storage.')
    pushToast('success', 'Saved', 'Workflow snapshot is stored in this browser.')
  }, [addLog, edges, nodes, normalizeEdges, pushToast])

  const loadWorkflow = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) {
      addLog('error', 'No saved workflow found in local storage.')
      pushToast('error', 'Nothing saved', 'Save a workflow before loading from local storage.')
      return
    }

    try {
      const parsed = JSON.parse(saved)
      loadGraph(parsed.nodes ?? [], parsed.edges ?? [], 'Loaded saved workflow from local storage.')
    } catch {
      addLog('error', 'Saved workflow could not be parsed.')
      pushToast('error', 'Load failed', 'The saved workflow JSON is invalid.')
    }
  }, [addLog, loadGraph, pushToast])

  const exportWorkflow = useCallback(() => {
    const blob = new Blob([JSON.stringify({ nodes, edges: normalizeEdges(edges), exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'flowstate-workflow.json'
    link.click()
    URL.revokeObjectURL(url)
    addLog('success', 'Exported workflow JSON.')
    pushToast('success', 'Exported', 'Downloaded flowstate-workflow.json.')
  }, [addLog, edges, nodes, normalizeEdges, pushToast])

  const importWorkflow = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      try {
        const parsed = JSON.parse(await file.text())
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
          throw new Error('Invalid workflow shape')
        }
        loadGraph(parsed.nodes, parsed.edges, `Imported ${file.name}.`)
      } catch {
        addLog('error', 'Import failed. JSON file does not match the workflow schema.')
        pushToast('error', 'Import failed', 'Choose a JSON export generated by FlowState.')
      }
    },
    [addLog, loadGraph, pushToast],
  )

  const runWorkflow = useCallback(() => {
    if (isRunning || nodes.length === 0) return
    if (validation.blocking.length > 0) {
      addLog('error', `Run blocked by ${validation.blocking.length} validation issue${validation.blocking.length === 1 ? '' : 's'}.`)
      pushToast('error', 'Run blocked', 'Fix blocking validation issues before execution.')
      return
    }

    clearRunTimers()
    setIsRunning(true)
    setLogs([])
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: 'idle' } })))
    setEdges((current) => current.map((edge) => styleEdge(edge, 'idle')))

    const graph = buildExecutionGraph(nodes, edges)
    const completed = new Set()
    const started = new Set()
    const signalCounts = new Map(nodes.map((node) => [node.id, 0]))
    const reachableIds = getReachableNodeIds(nodes, edges)
    const startNodes = nodes.filter((node) => node.data.nodeType === 'start')

    addLog('info', `Circuit run started with ${reachableIds.size} reachable node${reachableIds.size === 1 ? '' : 's'}.`)

    function finishIfDone() {
      if (completed.size !== reachableIds.size) return
      setIsRunning(false)
      addLog('success', 'Workflow run complete.')
      pushToast('success', 'Run complete', 'The circuit finished after all connected signals settled.')
    }

    function deliverSignal(edge) {
      setEdges((current) => current.map((item) => styleEdge(item, item.id === edge.id ? 'running' : item.data?.status ?? 'idle')))

      const edgeTimer = window.setTimeout(() => {
        setEdges((current) => current.map((item) => styleEdge(item, item.id === edge.id ? 'complete' : item.data?.status ?? 'idle')))
        const nextCount = (signalCounts.get(edge.target) ?? 0) + 1
        signalCounts.set(edge.target, nextCount)
        const requiredSignals = graph.incoming.get(edge.target)?.length ?? 0
        if (nextCount < requiredSignals) {
          setNodes((current) =>
            current.map((item) =>
              item.id === edge.target && !started.has(item.id)
                ? { ...item, data: { ...item.data, status: 'waiting' } }
                : item,
            ),
          )
          addLog('info', `${graph.nodesById.get(edge.target)?.data.label ?? 'Node'} is waiting for ${requiredSignals - nextCount} more signal${requiredSignals - nextCount === 1 ? '' : 's'}.`)
        }
        if (nextCount >= requiredSignals) startNode(edge.target)
      }, NODE_GAP_MS)

      runTimerRef.current.push(edgeTimer)
    }

    function emitOutgoingSignals(node) {
      const timing = getNodeRunTiming(node)
      const outgoingEdges = graph.outgoing.get(node.id) ?? []

      if (outgoingEdges.length === 0) {
        setNodes((current) =>
          current.map((item) => (item.id === node.id ? { ...item, data: { ...item.data, status: 'complete' } } : item)),
        )
        completed.add(node.id)
        finishIfDone()
        return
      }

      if (timing.postDelayMs > 0) {
        addLog('info', `${node.data.label} is delaying outgoing signal for ${timing.label}${timing.capped ? ' (capped to 10s in simulation)' : ''}.`)
        setNodes((current) =>
          current.map((item) => (item.id === node.id ? { ...item, data: { ...item.data, status: 'delaying' } } : item)),
        )
      } else {
        completed.add(node.id)
      }

      const signalTimer = window.setTimeout(() => {
        if (timing.postDelayMs > 0) {
          completed.add(node.id)
          setNodes((current) =>
            current.map((item) => (item.id === node.id ? { ...item, data: { ...item.data, status: 'complete' } } : item)),
          )
        }
        outgoingEdges.forEach(deliverSignal)
        finishIfDone()
      }, timing.postDelayMs)

      runTimerRef.current.push(signalTimer)
    }

    function startNode(nodeId) {
      const node = graph.nodesById.get(nodeId)
      if (!node || started.has(nodeId) || !reachableIds.has(nodeId)) return
      started.add(nodeId)

      setNodes((current) =>
        current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, status: 'running' } } : item)),
      )
      addLog('info', `Executing ${node.data.label}.`)

      const timing = getNodeRunTiming(node)
      const doneTimer = window.setTimeout(() => {
        const timing = getNodeRunTiming(node)
        if (timing.postDelayMs === 0) {
          setNodes((current) =>
            current.map((item) => (item.id === nodeId ? { ...item, data: { ...item.data, status: 'complete' } } : item)),
          )
        }
        addLog('success', `${node.data.label} completed.`)
        emitOutgoingSignals(node)
        finishIfDone()
      }, timing.durationMs)

      runTimerRef.current.push(doneTimer)
    }

    startNodes.forEach((node) => startNode(node.id))
  }, [addLog, clearRunTimers, edges, isRunning, nodes, pushToast, setEdges, setNodes, validation.blocking.length])

  const commandActions = useMemo(
    () => [
      { id: 'run', label: 'Run workflow', hint: 'Ctrl Enter', icon: Play, action: runWorkflow },
      { id: 'save', label: 'Save to local storage', hint: 'Ctrl S', icon: Save, action: saveWorkflow },
      { id: 'load', label: 'Load saved workflow', hint: '', icon: Upload, action: loadWorkflow },
      { id: 'export', label: 'Export workflow JSON', hint: '', icon: Download, action: exportWorkflow },
      { id: 'import', label: 'Import workflow JSON', hint: '', icon: FileJson, action: openImportPicker },
      { id: 'duplicate', label: 'Duplicate selected node', hint: 'Ctrl D', icon: Copy, action: duplicateSelectedNode },
      { id: 'delete', label: 'Delete selected node', hint: 'Del', icon: Trash2, action: deleteSelectedNode },
      { id: 'layout', label: 'Clean circuit layout', hint: 'L', icon: LayoutDashboard, action: layoutWorkflow },
      { id: 'fit', label: 'Fit canvas view', hint: 'F', icon: LayoutGrid, action: () => fitView({ padding: 0.18, duration: 420 }) },
      { id: 'reset', label: 'Reset default workflow', hint: '', icon: RotateCcw, action: resetWorkflow },
    ],
    [deleteSelectedNode, duplicateSelectedNode, exportWorkflow, fitView, layoutWorkflow, loadWorkflow, openImportPicker, resetWorkflow, runWorkflow, saveWorkflow],
  )

  useEffect(() => {
    function onKeyDown(event) {
      const target = event.target
      const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((current) => !current)
        return
      }
      if (commandOpen) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveWorkflow()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        runWorkflow()
      }
      if (!isFormField && event.key === 'Delete') deleteSelectedNode()
      if (!isFormField && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelectedNode()
      }
      if (!isFormField && event.key.toLowerCase() === 'f') fitView({ padding: 0.18, duration: 420 })
      if (!isFormField && event.key.toLowerCase() === 'l') layoutWorkflow()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandOpen, deleteSelectedNode, duplicateSelectedNode, fitView, layoutWorkflow, runWorkflow, saveWorkflow])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0B0F1A] text-slate-100">
      <TopBar
        isRunning={isRunning}
        validation={validation}
        onRun={runWorkflow}
        onSave={saveWorkflow}
        onLoad={loadWorkflow}
        onReset={resetWorkflow}
        onExport={exportWorkflow}
        onImport={openImportPicker}
        onLayout={layoutWorkflow}
        onCommand={() => setCommandOpen(true)}
      />

      <main className="grid min-h-0 flex-1 grid-cols-[292px_minmax(0,1fr)_360px] border-y border-slate-800/80 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_34%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.11),transparent_30%),#0B0F1A]">
        <NodeLibrary onDragStart={onDragStart} onTemplate={(template) => loadGraph(template.nodes, template.edges, `Loaded template: ${template.name}.`)} />

        <section className="relative min-w-0 overflow-hidden border-x border-slate-800/80">
          <CanvasHud nodes={nodes} edges={edges} validation={validation} />
          <div className="h-full w-full">
            <ReactFlow
              nodes={displayNodes}
              edges={displayEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onSelectionChange={onSelectionChange}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              snapToGrid
              snapGrid={[20, 20]}
              proOptions={{ hideAttribution: true }}
              minZoom={0.35}
              maxZoom={1.65}
              defaultEdgeOptions={{
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#38bdf8', strokeWidth: 2.4 },
              }}
            >
              <Background color="#26324a" gap={24} size={1.15} />
              <Controls position="bottom-left" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeStrokeWidth={3}
                nodeColor={(node) => node.data?.color ?? '#38bdf8'}
                maskColor="rgba(2, 6, 23, 0.72)"
              />
            </ReactFlow>
          </div>
        </section>

        <PropertiesPanel
          selectedNode={selectedNode}
          validation={validation}
          updateNode={updateSelectedNode}
          onDuplicate={duplicateSelectedNode}
          onDelete={deleteSelectedNode}
        />
      </main>

      <ExecutionLog logs={logs} isRunning={isRunning} />
      <ToastStack toasts={toasts} />
      <CommandPalette
        open={commandOpen}
        query={commandQuery}
        setQuery={setCommandQuery}
        actions={commandActions}
        onClose={() => setCommandOpen(false)}
      />
      <input id={IMPORT_INPUT_ID} type="file" accept="application/json,.json" className="hidden" onChange={importWorkflow} />
    </div>
  )
}

function TopBar({ isRunning, validation, onRun, onSave, onLoad, onReset, onExport, onImport, onLayout, onCommand }) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-cyan-300/10 bg-slate-950/92 px-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 shadow-lg shadow-cyan-500/10">
          <Sparkles className="text-cyan-200" size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-wide text-white">FlowState</h1>
          <p className="truncate text-xs text-slate-400">Node-based workflow builder</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill validation={validation} />
        <ToolbarButton icon={Command} label="Command" onClick={onCommand} />
        <ToolbarButton icon={Upload} label="Load" onClick={onLoad} />
        <ToolbarButton icon={Save} label="Save" onClick={onSave} />
        <ToolbarButton icon={Download} label="Export" onClick={onExport} />
        <ToolbarButton icon={FileJson} label="Import" onClick={onImport} />
        <ToolbarButton icon={LayoutDashboard} label="Layout" onClick={onLayout} />
        <ToolbarButton icon={RotateCcw} label="Reset" onClick={onReset} />
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          onClick={onRun}
          disabled={isRunning}
          className="ml-2 inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-200/30 bg-cyan-400 px-4 text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.24)] transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
        >
          <Play size={16} fill="currentColor" />
          {isRunning ? 'Running' : 'Run'}
        </motion.button>
      </div>
    </header>
  )
}

function StatusPill({ validation }) {
  const blocked = validation.blocking.length
  const warnings = validation.warnings.length
  return (
    <div
      className={clsx(
        'hidden h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium lg:inline-flex',
        blocked
          ? 'border-rose-400/25 bg-rose-400/10 text-rose-100'
          : warnings
            ? 'border-amber-300/25 bg-amber-300/10 text-amber-100'
            : 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
      )}
    >
      {blocked ? <AlertTriangle size={16} /> : <Check size={16} />}
      {blocked ? `${blocked} blocking` : warnings ? `${warnings} warnings` : 'Valid'}
    </div>
  )
}

function ToolbarButton({ icon: Icon, label, onClick }) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      title={label}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 text-sm font-medium text-slate-200 transition hover:border-cyan-300/30 hover:bg-slate-800 hover:text-white"
    >
      <Icon size={16} />
      <span className="hidden xl:inline">{label}</span>
    </motion.button>
  )
}

function NodeLibrary({ onDragStart, onTemplate }) {
  return (
    <aside className="min-h-0 overflow-y-auto bg-slate-950/72 p-4 backdrop-blur-xl">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">Node Library</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Build blocks</h2>
      </div>

      <div className="space-y-3">
        {nodeCatalog.map((item) => (
          <motion.div
            key={item.type}
            draggable
            onDragStart={(event) => onDragStart(event, item)}
            whileHover={{ scale: 1.02, x: 2 }}
            whileTap={{ scale: 0.99 }}
            className="group cursor-grab rounded-2xl border border-slate-800 bg-slate-900/72 p-3 shadow-xl shadow-black/10 transition hover:border-cyan-300/25 hover:bg-slate-900 active:cursor-grabbing"
          >
            <div className="flex items-center gap-3">
              <div
                className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10"
                style={{
                  backgroundColor: `${item.color}1F`,
                  color: item.color,
                  boxShadow: `0 0 22px ${item.color}18`,
                }}
              >
                <item.icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-100">{item.label}</p>
                <p className="truncate text-xs text-slate-400">{item.description}</p>
              </div>
              <ArrowRight className="text-slate-600 transition group-hover:text-cyan-200" size={16} />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Zap size={16} className="text-fuchsia-200" />
          Templates
        </div>
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.name}
              onClick={() => onTemplate(template)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/58 p-3 text-left transition hover:border-fuchsia-300/25 hover:bg-slate-900"
            >
              <span className="block text-sm font-semibold text-slate-100">{template.name}</span>
              <span className="mt-1 block text-xs text-slate-500">{template.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-cyan-100">
          <Keyboard size={16} />
          Shortcuts
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-xs text-slate-400">
          <span>Command palette</span>
          <kbd className="kbd">Ctrl K</kbd>
          <span>Run workflow</span>
          <kbd className="kbd">Ctrl Enter</kbd>
          <span>Duplicate node</span>
          <kbd className="kbd">Ctrl D</kbd>
          <span>Clean layout</span>
          <kbd className="kbd">L</kbd>
        </div>
      </div>
    </aside>
  )
}

function CanvasHud({ nodes, edges, validation }) {
  return (
    <div className="pointer-events-none absolute left-5 top-5 z-10 flex items-center gap-3 rounded-xl border border-cyan-300/15 bg-slate-950/72 px-4 py-3 shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
      <div className="grid size-9 place-items-center rounded-lg bg-cyan-400/12 text-cyan-200">
        <LayoutGrid size={18} />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-100">Production Workflow</p>
        <p className="text-xs text-slate-400">
          {nodes.length} nodes / {edges.length} connections / {validation.issues.length} findings
        </p>
      </div>
    </div>
  )
}

function WorkflowNode({ data, selected }) {
  const Icon = catalogByType[data.nodeType]?.icon ?? Binary
  const isRunning = data.status === 'running'
  const isDelaying = data.status === 'delaying'
  const isWaiting = data.status === 'waiting'
  const isComplete = data.status === 'complete'
  const hasWarnings = data.warnings?.length > 0

  return (
    <motion.div
      whileHover={{ scale: 1.035 }}
      className={clsx(
        'relative w-[232px] rounded-2xl border bg-slate-950/92 p-3 shadow-2xl backdrop-blur-xl transition-colors duration-200',
        selected ? 'border-cyan-200/80' : hasWarnings ? 'border-amber-300/50' : 'border-slate-700/80',
      )}
      style={{
        boxShadow:
          selected || isRunning || isDelaying || isWaiting
            ? `0 0 0 1px ${data.color}55, 0 0 36px ${data.color}4A, 0 18px 55px rgba(0,0,0,.38)`
            : hasWarnings
              ? '0 0 28px rgba(245,158,11,.16), 0 18px 50px rgba(0,0,0,.34)'
              : '0 18px 50px rgba(0,0,0,.34)',
      }}
    >
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-slate-950 !bg-cyan-300" />
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-slate-950 !bg-cyan-300" />

      <div className="flex items-center gap-3">
        <div
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10"
          style={{ backgroundColor: `${data.color}1F`, color: data.color }}
        >
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{data.label}</p>
          <p className="truncate text-xs text-slate-400">{data.description}</p>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-900/72 px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">State</span>
          <NodeStatus status={data.status} />
        </div>
        <p className="mt-2 truncate font-mono text-[11px] text-slate-500">{getNodePreview(data)}</p>
      </div>

      {hasWarnings && (
        <div className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-slate-950 bg-amber-300 text-slate-950 shadow-[0_0_20px_rgba(251,191,36,.35)]">
          <AlertTriangle size={15} strokeWidth={3} />
        </div>
      )}

      {(isRunning || isDelaying || isWaiting) && (
        <motion.div
          layoutId="runner"
          className="absolute inset-x-4 -bottom-px h-px rounded-full"
          style={{
            backgroundColor: isWaiting ? '#fbbf24' : isDelaying ? '#f0abfc' : data.color,
            boxShadow: `0 0 18px ${isWaiting ? '#fbbf24' : isDelaying ? '#f0abfc' : data.color}`,
          }}
        />
      )}

      {isComplete && (
        <div className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-emerald-400 text-slate-950">
          <Check size={14} strokeWidth={3} />
        </div>
      )}
    </motion.div>
  )
}

function NodeStatus({ status }) {
  const styles = {
    idle: 'bg-slate-700 text-slate-200',
    waiting: 'bg-amber-300 text-slate-950',
    running: 'bg-cyan-300 text-slate-950',
    delaying: 'bg-fuchsia-300 text-slate-950',
    complete: 'bg-emerald-400 text-slate-950',
  }

  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', styles[status])}>
      {status}
    </span>
  )
}

function PropertiesPanel({ selectedNode, validation, updateNode, onDuplicate, onDelete }) {
  return (
    <aside className="min-h-0 overflow-y-auto bg-slate-950/72 p-4 backdrop-blur-xl">
      <ValidationPanel validation={validation} />
      <AnimatePresence mode="wait">
        {selectedNode ? (
          <motion.div
            key={selectedNode.id}
            initial={{ opacity: 0, x: 22 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 22 }}
            transition={{ duration: 0.22 }}
            className="mt-5"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fuchsia-200/80">Properties</p>
                <h2 className="mt-2 truncate text-xl font-semibold text-white">{selectedNode.data.label}</h2>
              </div>
              <div
                className="grid size-11 place-items-center rounded-xl border border-white/10"
                style={{
                  backgroundColor: `${selectedNode.data.color}1F`,
                  color: selectedNode.data.color,
                }}
              >
                <DatabaseZap size={20} />
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              <ToolbarButton icon={Copy} label="Duplicate" onClick={onDuplicate} />
              <ToolbarButton icon={Trash2} label="Delete" onClick={onDelete} />
            </div>

            <div className="space-y-4">
              <Field label="Display name">
                <input value={selectedNode.data.label} onChange={(event) => updateNode({ label: event.target.value })} className="input" />
              </Field>

              <ConfigFields node={selectedNode} updateNode={updateNode} />
            </div>

            {selectedNode.data.warnings?.length > 0 && (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/8 p-4">
                <p className="text-sm font-semibold text-amber-100">Node findings</p>
                <ul className="mt-3 space-y-2">
                  {selectedNode.data.warnings.map((warning) => (
                    <li key={warning} className="flex gap-2 text-sm leading-5 text-amber-100/80">
                      <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            className="flex min-h-[300px] flex-col items-center justify-center text-center"
          >
            <div className="grid size-14 place-items-center rounded-2xl border border-slate-800 bg-slate-900/80 text-slate-400">
              <Activity size={24} />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">Select a node</h2>
            <p className="mt-2 max-w-[240px] text-sm leading-6 text-slate-400">
              Node-specific settings appear here with live updates to the canvas.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

function ValidationPanel({ validation }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-cyan-200" />
          <h2 className="text-sm font-semibold text-white">Validation</h2>
        </div>
        <span className="text-xs text-slate-500">{validation.issues.length} findings</span>
      </div>
      <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
        {validation.issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-300/15 bg-emerald-300/8 px-3 py-2 text-sm text-emerald-100">
            <Check size={14} />
            Ready to run
          </div>
        ) : (
          validation.issues.map((issue) => (
            <div
              key={`${issue.nodeId ?? 'global'}-${issue.message}`}
              className={clsx(
                'flex gap-2 rounded-xl border px-3 py-2 text-sm leading-5',
                issue.severity === 'error'
                  ? 'border-rose-300/20 bg-rose-400/8 text-rose-100'
                  : 'border-amber-300/20 bg-amber-300/8 text-amber-100',
              )}
            >
              <AlertTriangle className="mt-0.5 shrink-0" size={14} />
              {issue.message}
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function ConfigFields({ node, updateNode }) {
  const config = node.data.config
  const type = node.data.nodeType

  if (type === 'api') {
    return (
      <>
        <Field label="URL">
          <input value={config.url} onChange={(event) => updateNode({ config: { url: event.target.value } })} className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <Select value={config.method} onChange={(value) => updateNode({ config: { method: value } })} options={['GET', 'POST', 'PUT', 'PATCH']} />
          </Field>
          <Field label="Timeout">
            <input type="number" min="1" value={config.timeout} onChange={(event) => updateNode({ config: { timeout: event.target.value } })} className="input" />
          </Field>
        </div>
      </>
    )
  }

  if (type === 'condition') {
    return (
      <>
        <Field label="Field">
          <input value={config.field} onChange={(event) => updateNode({ config: { field: event.target.value } })} className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Operator">
            <Select value={config.operator} onChange={(value) => updateNode({ config: { operator: value } })} options={['equals', 'contains', 'greater than']} />
          </Field>
          <Field label="Value">
            <input value={config.value} onChange={(event) => updateNode({ config: { value: event.target.value } })} className="input" />
          </Field>
        </div>
      </>
    )
  }

  if (type === 'delay') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duration">
          <input type="number" min="1" value={config.duration} onChange={(event) => updateNode({ config: { duration: event.target.value } })} className="input" />
        </Field>
        <Field label="Unit">
          <Select value={config.unit} onChange={(value) => updateNode({ config: { unit: value } })} options={['seconds', 'minutes', 'hours']} />
        </Field>
      </div>
    )
  }

  if (type === 'transform') {
    return (
      <>
        <Field label="Mode">
          <Select value={config.mode} onChange={(value) => updateNode({ config: { mode: value } })} options={['Map fields', 'Filter rows', 'Normalize']} />
        </Field>
        <Field label="Expression">
          <textarea value={config.expression} onChange={(event) => updateNode({ config: { expression: event.target.value } })} className="input min-h-28 resize-none leading-6" />
        </Field>
      </>
    )
  }

  if (type === 'output') {
    return (
      <>
        <Field label="Channel">
          <Select value={config.channel} onChange={(value) => updateNode({ config: { channel: value } })} options={['Slack', 'Email', 'Webhook', 'Database']} />
        </Field>
        <Field label="Target">
          <input value={config.target} onChange={(event) => updateNode({ config: { target: event.target.value } })} className="input" />
        </Field>
      </>
    )
  }

  return (
    <>
      <Field label="Trigger">
        <input value={config.trigger} onChange={(event) => updateNode({ config: { trigger: event.target.value } })} className="input" />
      </Field>
      <Field label="Retries">
        <input type="number" min="0" value={config.retries} onChange={(event) => updateNode({ config: { retries: event.target.value } })} className="input" />
      </Field>
    </>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select value={value} onChange={(event) => onChange(event.target.value)} className="input appearance-none pr-9">
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
    </div>
  )
}

function ExecutionLog({ logs, isRunning }) {
  return (
    <footer className="h-36 shrink-0 border-t border-slate-800 bg-slate-950/94 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Terminal size={16} className="text-cyan-200" />
          Execution Logs
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className={clsx('size-2 rounded-full', isRunning ? 'bg-cyan-300 shadow-[0_0_12px_#67e8f9]' : 'bg-slate-600')} />
          {isRunning ? 'Streaming' : 'Idle'}
        </div>
      </div>
      <div className="h-[86px] overflow-y-auto rounded-xl border border-slate-800 bg-[#080c14] p-3">
        <AnimatePresence initial={false}>
          {logs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-1 flex items-center gap-2 font-mono text-xs text-slate-300"
            >
              {log.level === 'error' ? (
                <AlertTriangle size={13} className="text-rose-400" />
              ) : log.level === 'success' ? (
                <Check size={13} className="text-emerald-300" />
              ) : (
                <Activity size={13} className="text-cyan-300" />
              )}
              <span className="text-slate-600">flowstate:</span>
              <span>{log.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </footer>
  )
}

function CommandPalette({ open, query, setQuery, actions, onClose }) {
  const filteredActions = actions.filter((action) =>
    action.label.toLowerCase().includes(query.trim().toLowerCase()),
  )

  useEffect(() => {
    if (!open) setQuery('')
  }, [open, setQuery])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-slate-950/68 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            onMouseDown={(event) => event.stopPropagation()}
            className="w-[min(620px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-cyan-300/20 bg-slate-950 shadow-[0_30px_90px_rgba(0,0,0,.55)]"
          >
            <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
              <Search size={18} className="text-cyan-200" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') onClose()
                  if (event.key === 'Enter' && filteredActions[0]) {
                    filteredActions[0].action()
                    onClose()
                  }
                }}
                placeholder="Search commands..."
                className="h-10 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
              />
              <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-900 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {filteredActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => {
                    action.action()
                    onClose()
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-cyan-300/10"
                >
                  <span className="grid size-9 place-items-center rounded-lg bg-slate-900 text-cyan-200">
                    <action.icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-100">{action.label}</span>
                  {action.hint && <kbd className="kbd">{action.hint}</kbd>}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ToastStack({ toasts }) {
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-40 w-[320px] space-y-3">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 24, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.98 }}
            className={clsx(
              'rounded-2xl border bg-slate-950/94 p-4 shadow-2xl backdrop-blur-xl',
              toast.tone === 'error'
                ? 'border-rose-300/25'
                : toast.tone === 'success'
                  ? 'border-emerald-300/25'
                  : 'border-cyan-300/25',
            )}
          >
            <p className="text-sm font-semibold text-white">{toast.title}</p>
            <p className="mt-1 text-sm leading-5 text-slate-400">{toast.text}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function getNodePreview(data) {
  const config = data.config
  if (data.nodeType === 'api') return `${config.method} ${config.url || 'missing-url'}`
  if (data.nodeType === 'condition') return `${config.field || 'field'} ${config.operator} ${config.value || 'value'}`
  if (data.nodeType === 'delay') return `${config.duration} ${config.unit}`
  if (data.nodeType === 'transform') return config.mode
  if (data.nodeType === 'output') return `${config.channel} -> ${config.target || 'target'}`
  return config.trigger
}

function getNodeRunTiming(node) {
  if (node.data.nodeType !== 'delay') {
    return { durationMs: BASE_NODE_RUN_MS, postDelayMs: 0, label: 'instant', capped: false }
  }

  const duration = Math.max(0, Number(node.data.config.duration) || 0)
  const unit = node.data.config.unit
  const multiplier = unit === 'hours' ? 60 * 60 * 1000 : unit === 'minutes' ? 60 * 1000 : 1000
  const requestedMs = duration * multiplier
  const capped = requestedMs > MAX_SIMULATED_DELAY_MS
  return {
    durationMs: BASE_NODE_RUN_MS,
    postDelayMs: Math.min(requestedMs, MAX_SIMULATED_DELAY_MS),
    label: `${duration} ${unit}`,
    capped,
  }
}

function styleEdge(edge, status) {
  const active = status === 'running'
  const complete = status === 'complete'
  return {
    ...edge,
    type: 'smoothstep',
    animated: active || edge.animated,
    className: active ? 'edge-running' : complete ? 'edge-complete' : '',
    data: { ...(edge.data ?? {}), status },
    style: {
      stroke: active ? '#67e8f9' : complete ? '#34d399' : '#38bdf8',
      strokeWidth: active ? 3.6 : 2.4,
      opacity: complete ? 0.85 : 1,
    },
  }
}

function decorateEdges(edges, nodes) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  return edges.map((edge) => {
    const source = nodesById.get(edge.source)
    if (source?.data.nodeType !== 'delay') return edge

    const timing = getNodeRunTiming(source)
    return {
      ...edge,
      label: timing.label,
      labelShowBg: true,
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 8,
      labelBgStyle: {
        fill: 'rgba(15, 23, 42, 0.92)',
        stroke: 'rgba(250, 204, 21, 0.36)',
      },
      labelStyle: {
        fill: '#fde68a',
        fontSize: 11,
        fontWeight: 700,
      },
    }
  })
}

function autoLayoutNodes(nodes, edges) {
  const graph = buildExecutionGraph(nodes, edges)
  const startNodes = nodes.filter((node) => node.data.nodeType === 'start')
  const depthById = new Map()
  const queue = startNodes.map((node) => ({ id: node.id, depth: 0 }))

  while (queue.length > 0) {
    const current = queue.shift()
    const existingDepth = depthById.get(current.id)
    if (existingDepth !== undefined && existingDepth <= current.depth) continue
    depthById.set(current.id, current.depth)
    ;(graph.outgoing.get(current.id) ?? []).forEach((edge) => {
      queue.push({ id: edge.target, depth: current.depth + 1 })
    })
  }

  let orphanDepth = Math.max(0, ...depthById.values()) + 1
  nodes.forEach((node) => {
    if (!depthById.has(node.id)) depthById.set(node.id, orphanDepth++)
  })

  const lanes = new Map()
  nodes.forEach((node) => {
    const depth = depthById.get(node.id) ?? 0
    lanes.set(depth, [...(lanes.get(depth) ?? []), node])
  })

  const yStep = 170
  const xStep = 300
  const baseX = 80
  const baseY = 90

  return nodes.map((node) => {
    const depth = depthById.get(node.id) ?? 0
    const lane = [...(lanes.get(depth) ?? [])].sort((a, b) => a.position.y - b.position.y)
    const row = lane.findIndex((item) => item.id === node.id)
    const centeredRow = row - (lane.length - 1) / 2
    return {
      ...node,
      position: {
        x: baseX + depth * xStep,
        y: baseY + centeredRow * yStep,
      },
    }
  })
}

function getNextNodeId(nodes) {
  const highestId = nodes.reduce((max, node) => {
    const value = Number(String(node.id).replace('node-', ''))
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  return highestId + 1
}

function buildExecutionGraph(nodes, edges) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  const outgoing = new Map(nodes.map((node) => [node.id, []]))

  edges.forEach((edge) => {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) return
    incoming.get(edge.target)?.push(edge)
    outgoing.get(edge.source)?.push(edge)
  })

  return { nodesById, incoming, outgoing }
}

function getReachableNodeIds(nodes, edges) {
  const graph = buildExecutionGraph(nodes, edges)
  const startNodes = nodes.filter((node) => node.data.nodeType === 'start')
  const reachable = new Set()

  function walk(nodeId) {
    if (reachable.has(nodeId)) return
    reachable.add(nodeId)
    ;(graph.outgoing.get(nodeId) ?? []).forEach((edge) => walk(edge.target))
  }

  startNodes.forEach((node) => walk(node.id))
  return reachable
}

function validateWorkflow(nodes, edges) {
  const issues = []
  const startNodes = nodes.filter((node) => node.data.nodeType === 'start')
  const outputNodes = nodes.filter((node) => node.data.nodeType === 'output')
  const incoming = new Map()
  const outgoing = new Map()

  edges.forEach((edge) => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1)
  })

  if (startNodes.length !== 1) issues.push({ severity: 'error', message: 'Workflow must contain exactly one Start node.' })
  if (outputNodes.length < 1) issues.push({ severity: 'error', message: 'Workflow needs at least one Output node.' })
  if (nodes.length > 1 && edges.length === 0) issues.push({ severity: 'error', message: 'Nodes are not connected.' })

  nodes.forEach((node) => {
    if (node.data.nodeType !== 'start' && !incoming.has(node.id)) {
      issues.push({ severity: 'error', nodeId: node.id, message: `${node.data.label} has no incoming connection.` })
    }
    if (node.data.nodeType !== 'output' && !outgoing.has(node.id)) {
      issues.push({ severity: 'warning', nodeId: node.id, message: `${node.data.label} has no outgoing connection.` })
    }
    if (node.data.nodeType === 'api' && !String(node.data.config.url ?? '').trim()) {
      issues.push({ severity: 'error', nodeId: node.id, message: 'API nodes require a URL.' })
    }
    if (node.data.nodeType === 'delay' && Number(node.data.config.duration) <= 0) {
      issues.push({ severity: 'error', nodeId: node.id, message: 'Delay duration must be greater than zero.' })
    }
    if (node.data.nodeType === 'transform' && !String(node.data.config.expression ?? '').trim()) {
      issues.push({ severity: 'warning', nodeId: node.id, message: 'Transform node has an empty expression.' })
    }
    if (node.data.nodeType === 'output' && !String(node.data.config.target ?? '').trim()) {
      issues.push({ severity: 'error', nodeId: node.id, message: 'Output nodes require a target.' })
    }
  })

  if (hasCycle(nodes, edges)) issues.push({ severity: 'error', message: 'Workflow contains a cycle.' })

  return {
    issues,
    blocking: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  }
}

function hasCycle(nodes, edges) {
  const graph = new Map(nodes.map((node) => [node.id, []]))
  edges.forEach((edge) => graph.get(edge.source)?.push(edge.target))
  const visiting = new Set()
  const visited = new Set()

  function visit(id) {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of graph.get(id) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  return nodes.some((node) => visit(node.id))
}

export default App
