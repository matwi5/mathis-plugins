// Contrat du mod decors-pixel : l'état de session (`$.state`) que ses dessins lisent.

// L'habillage du texte par-dessus le décor.
export type Dressing = {
  // De l'espace entre les lignes des bandeaux, au-dessus de la saisie.
  bands: boolean
  // Le voile de plus posé sous les bandeaux, en % ; 0 : aucun.
  veil: number

  // Le mode de l'app sous la scène affichée, qui donne sa teinte à ce voile. « auto » :
  // Paris suit le mode de l'app, que le mod ne voit pas, et le voile ne se pose pas.
  tone: 'light' | 'dark' | 'auto'
}

declare module 'claude-code' {
  interface PluginState {
    'decors-pixel': { dressing: Shaped<Dressing> }
  }
}
