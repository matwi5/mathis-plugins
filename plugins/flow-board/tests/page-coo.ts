// Chercher dans la vue Coordination du COO, répartie en six pages choisies par des pastilles, comme dans l'ancienne
// vue d'une seule liste : `findAny`, `findAllAny` et `pressAny` passent les pages une à une (par
// leur pastille, `coo-page-<page>`) et prennent la première où l'élément se trouve ; `allTexts` lit les textes de toutes
// les pages. Sur un panneau sans pastilles (pas la discussion du COO, un autre onglet), ils cherchent dans le panneau tel
// quel. Les tests de la répartition elle-même (`pages-coordination.test.ts`) nomment leur page.
// Un module d'aide, pas un fichier de test.

const PAGES = ['todo', 'missions', 'ideas', 'pending', 'pistes', 'settings'] as const

/** Le panneau porte-t-il la rangée des pages de la vue Coordination ? */
const hasPages = async (pane: any): Promise<boolean> => (await pane.find({ key: 'coo-page-todo' })) !== undefined

/** Le premier élément qui répond à la recherche, sur la première page qui l'a ; undefined s'il n'est sur aucune. */
export const findAny = async (pane: any, query: Record<string, unknown>): Promise<any> => {
  if (!(await hasPages(pane))) return pane.find(query)
  for (const page of PAGES) {
    await pane.press({ key: `coo-page-${page}` })
    const found = await pane.find(query)
    if (found !== undefined) return found
  }
  return undefined
}

/** Tous les éléments qui répondent à la recherche, page après page. */
export const findAllAny = async (pane: any, query: Record<string, unknown>): Promise<any[]> => {
  if (!(await hasPages(pane))) return pane.findAll(query)
  const all: any[] = []
  for (const page of PAGES) {
    await pane.press({ key: `coo-page-${page}` })
    all.push(...((await pane.findAll(query)) as any[]))
  }
  return all
}

/** Presse l'élément sur la première page qui l'a (une recherche qui ne trouve rien échoue comme `press`). */
export const pressAny = async (pane: any, query: Record<string, unknown>): Promise<void> => {
  if (await hasPages(pane)) await findAny(pane, query)
  await pane.press(query)
}

/** Les textes de toutes les pages, une ligne par texte. */
export const allTexts = async (pane: any): Promise<string> => ((await findAllAny(pane, { type: 'Text' })) as any[]).map(t => String(t.props.text ?? t.text ?? '')).join('\n')
