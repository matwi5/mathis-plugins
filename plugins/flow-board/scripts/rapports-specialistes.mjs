#!/usr/bin/env node
// Les rapports des spécialistes d'une session, pour une rétro ou une analyse qui les lit sans relire
// chaque transcript (l'extraction des 1 041 spécialistes d'une mission avait manqué ceux rendus par la
// remise de fin, `SubagentHandback`) :
//
//   node <dossier de flow-board>/scripts/rapports-specialistes.mjs <projet>/<session>.jsonl [--prefixe <début du nom>]
//
// Pour chaque spécialiste du dossier `<projet>/<session>/subagents/` (fichiers `agent-<id>.jsonl`, avec à
// côté `agent-<id>.meta.json`), et de ses dossiers `workflows/<run>/` (les spécialistes d'un Workflow),
// dans l'ordre de sa première ligne datée : son nom (la description du lancement), son type, son modèle
// (celui du lancement, sinon le dernier vu dans son transcript, hors messages d'erreur « <synthetic> »),
// son effort (« non donné au lancement » quand le lancement n'en a pas donné : il vient alors de la
// définition du spécialiste ou du poste), s'il a fini, sous une ligne « === <nom> » (les rapports ont
// leurs propres titres « ## »), puis son rapport final : le message de sa dernière remise de fin, sinon
// son dernier texte ; un spécialiste dont la dernière ligne est une erreur de Claude Code le dit (« fin
// sur une erreur »). `--prefixe` ne garde que les noms qui commencent ainsi (« Spec · », « Sécurité · »).
// Les chemins lus viennent seulement de l'argument et du listage de ces dossiers, jamais d'une valeur lue
// dans un transcript ; un `meta.json`, une ligne ou un dossier `workflows/<run>/` illisible se signale
// sur la sortie d'erreur et se saute ; un transcript absent, ou un dossier `subagents/` qui ne se lit
// pas, fait échouer le script (code 1) : une rétro conclurait à tort qu'il n'y a eu aucun spécialiste.
// Un « ~/ » en tête est remplacé par le dossier personnel. Lecture seule, sans dépendance hors de Node.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Un fichier de transcript d'un spécialiste, nommé par le listage : `agent-<id>.jsonl`. */
const AGENT_FILE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/

const fail = message => {
  console.error(`ÉCHEC : ${message}`)
  process.exit(1)
}

/** Les arguments : le transcript, et le préfixe facultatif. */
const parseArgs = argv => {
  let transcript = null
  let prefix = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prefixe') {
      if (i + 1 >= argv.length) fail('--prefixe attend le début du nom')
      prefix = argv[++i]
    } else if (transcript === null) transcript = argv[i]
    else fail(`argument en trop : ${argv[i]}`)
  }
  if (transcript === null) fail('usage : rapports-specialistes.mjs <projet>/<session>.jsonl [--prefixe <début du nom>]')
  if (!transcript.endsWith('.jsonl')) fail(`pas un transcript (.jsonl) : ${transcript}`)
  // Un « ~/ » cité entre guillemets n'est pas remplacé par le shell : le script le remplace.
  const path = transcript.startsWith('~/') ? join(homedir(), transcript.slice(2)) : transcript
  // Un transcript absent n'est pas une session sans spécialiste : une rétro conclurait à tort qu'il n'y en a eu aucun.
  if (!existsSync(path) || !statSync(path).isFile()) fail(`transcript introuvable : ${path}`)
  return { transcript: path, prefix }
}

/** Le `meta.json` d'un spécialiste, ou null (absent ou illisible, signalé). */
const readMeta = (dir, id, rel) => {
  const file = join(dir, `agent-${id}.meta.json`)
  if (!existsSync(file)) return null
  try {
    const meta = JSON.parse(readFileSync(file, 'utf8'))
    if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) return meta
  } catch {
    // signalé ci-dessous
  }
  console.error(`${rel}agent-${id}.meta.json illisible : sauté`)
  return null
}

/** Le texte d'un champ lu, ou null. */
const str = v => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Ce que dit le transcript d'un spécialiste : sa première date, le dernier modèle vu, et son rapport final
 * (la dernière remise de fin, sinon le dernier bloc de texte d'une ligne de l'assistant), et l'erreur de
 * Claude Code sur laquelle il a fini, quand sa dernière ligne de l'assistant en est une.
 */
const readTranscript = (dir, file, rel) => {
  let first = null
  let model = null
  let handback = null
  let lastText = null
  let error = null
  readFileSync(join(dir, file), 'utf8').split('\n').forEach((raw, n) => {
    if (raw.trim() === '') return
    let entry
    try {
      entry = JSON.parse(raw)
    } catch {
      console.error(`${rel}${file}:${n + 1} illisible : sautée`)
      return
    }
    if (entry === null || typeof entry !== 'object') return
    if (first === null) first = str(entry.timestamp)
    const message = entry.message
    if (message === null || typeof message !== 'object' || message.role !== 'assistant') return
    const content = Array.isArray(message.content) ? message.content : []
    // Un message d'erreur écrit par Claude Code (modèle « <synthetic> ») n'est ni le modèle ni le dernier
    // texte du spécialiste, mais il dit qu'il s'est arrêté dessus, tant qu'aucune vraie ligne ne suit.
    if (message.model === '<synthetic>') {
      error = content.map(b => (b !== null && typeof b === 'object' && b.type === 'text' ? str(b.text) : null)).find(t => t !== null) ?? 'erreur sans texte'
      return
    }
    error = null
    model = str(message.model) ?? model
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'tool_use' && block.name === 'SubagentHandback') handback = str(block.input?.message) ?? handback
      else if (block.type === 'text') lastText = str(block.text) ?? lastText
    }
  })
  return { first, model, handback, lastText, error }
}

const yesNo = v => (v === true ? 'oui' : v === false ? 'non' : 'inconnu')

/** Les noms d'un dossier, triés ; null (signalé) quand il ne se lit pas. */
const listing = (dir, shown) => {
  try {
    return readdirSync(dir).sort()
  } catch {
    console.error(`${shown} illisible : sauté`)
    return null
  }
}

/** Le chemin est un dossier (faux pour un lien cassé ou un fichier sans droit, sans lever). */
const isDir = path => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Les spécialistes d'un dossier (`subagents/`, ou un `workflows/<run>/` en dessous), `rel` : son chemin
 * affiché, relatif à `subagents/`.
 */
const collect = (dir, rel, prefix, agents) => {
  for (const file of listing(dir, rel || 'subagents/') ?? []) {
    const m = AGENT_FILE.exec(file)
    if (!m) continue
    const shown = `${rel}${file}`
    // Un lien cassé ou un fichier sans droit de lecture se signale et se saute, comme une ligne illisible.
    let isFile = false
    try {
      isFile = statSync(join(dir, file)).isFile()
    } catch {
      console.error(`${shown} illisible : sauté`)
    }
    if (!isFile) continue
    const id = m[1]
    const meta = readMeta(dir, id, rel)
    const name = str(meta?.description) ?? `agent-${id}`
    if (!name.startsWith(prefix)) continue
    let read
    try {
      read = readTranscript(dir, file, rel)
    } catch {
      console.error(`${shown} illisible : sauté`)
      continue
    }
    agents.push({ id, shown, meta, name, ...read })
  }
}

const main = () => {
  const { transcript, prefix } = parseArgs(process.argv.slice(2))
  const dir = join(transcript.slice(0, -'.jsonl'.length), 'subagents')
  if (!existsSync(dir)) {
    console.log(`aucun spécialiste : pas de dossier ${dir}`)
    return
  }
  // Le dossier est là mais ne se lit pas : un échec, jamais « aucun spécialiste ».
  if (!isDir(dir) || listing(dir, 'subagents/') === null) fail(`dossier illisible : ${dir}`)
  const agents = []
  collect(dir, '', prefix, agents)
  // Les spécialistes lancés par un Workflow vivent un niveau plus bas : `workflows/<run>/agent-<id>.jsonl`.
  const workflows = join(dir, 'workflows')
  if (isDir(workflows)) {
    for (const run of listing(workflows, 'workflows/') ?? []) {
      if (isDir(join(workflows, run))) collect(join(workflows, run), `workflows/${run}/`, prefix, agents)
    }
  }
  // Les spécialistes sans ligne datée en dernier.
  agents.sort((a, b) => (a.first === null ? 1 : 0) - (b.first === null ? 1 : 0) || (a.first ?? '').localeCompare(b.first ?? ''))
  if (agents.length === 0) {
    console.log(prefix === '' ? `aucun spécialiste dans ${dir}` : `aucun spécialiste dont le nom commence par « ${prefix} » dans ${dir}`)
    return
  }
  const blocks = agents.map(a => {
    const source = a.handback !== null ? 'remise de fin' : a.lastText !== null ? 'dernier texte' : 'aucun'
    const fields = [
      `type : ${str(a.meta?.agentType) ?? 'inconnu'}`,
      `modèle : ${str(a.meta?.model) ?? a.model ?? 'inconnu'}`,
      // Sans effort au lancement, il vient de la définition du spécialiste (son en-tête) ou du poste : le script ne le connaît pas.
      `effort : ${str(a.meta?.effort) ?? 'non donné au lancement'}`,
      `fini : ${yesNo(a.meta?.finished)}`,
      `rapport : ${source}`,
    ].join(' · ')
    const error = a.error === null ? '' : `fin sur une erreur : ${a.error}\n`
    return `=== ${a.name}\n${fields}\n${error}fichier : ${a.shown}\n\n${a.handback ?? a.lastText ?? '(aucun texte)'}\n`
  })
  console.log(blocks.join('\n'))
}

main()
