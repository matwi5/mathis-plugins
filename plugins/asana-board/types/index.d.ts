// Une tâche Asana telle que le panneau la garde : sous-tâches aplaties, parent noté.
export type AsanaTask = {
  gid: string;
  name: string;
  completed: boolean;
  assignee: string | null;
  notes: string;
  statut: string | null;
  due: string | null;
  modified: string | null;
  url: string | null;
  parent: string | null;
  parentName: string | null;
  childCount: number;
};

// Ce que le panneau affiche autour de la liste : le projet, le chargement, l'erreur.
// `error` n'est écrit que par une lecture demandée (/asana, ↻) ; une lecture de fond
// (démarrage, relecture après un outil de Claude) échoue en silence. `loadedAt` non nul
// = au moins une lecture réussie : le bandeau ne s'affiche qu'à partir de là.
export type PanelMeta = {
  folder: string | null;
  section: string | null;
  sectionGid: string | null;
  projectGid: string | null;
  server: string | null;
  loading: string | null;
  error: string | null;
  warning: string | null;
  loadedAt: number | null;
};

// Le retour gardé sous une tâche ou sous le formulaire, en plus du toast : une erreur
// d'écriture surtout. `gid` vaut "new" pour le formulaire de création.
export type Notice = { gid: string; text: string; isError: boolean } | null;

// Le formulaire « Nouvelle tâche », gardé pendant la saisie.
export type Draft = {
  name: string;
  statut: string;
  who: string;
  where: string;
  contexte: string;
  fini: string;
  due: string;
};

declare module "claude-code" {
  interface PluginState {
    "asana-board": {
      tasks: AsanaTask[];
      meta: PanelMeta;
      expanded: string[];
      showDone: boolean;
      collapsed: string[];
      who: string;
      notice: Notice;
      editing: string | null;
      confirmDelete: string | null;
      creating: boolean;
      draft: Draft;
      /** Bandeau masqué par « x » ou /asana hide, le temps de la session. */
      isBandHidden: boolean;
      /** Tâches (gid, ou « new » pour le formulaire) dont une écriture est en cours. */
      busy: string[];
      /** Groupes montrés en entier (« ▸ tout voir »), par clé de groupe ou « done ». */
      showAll: string[];
    };
  }
}
