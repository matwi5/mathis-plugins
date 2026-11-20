---
description: Tableau de bord du workflow mattpocock, dès le premier message (même commande que /flow)
argument-hint: "[activity|history|commands|hide|show|pause|done|reset|rename <titre>|archive on|off]"
disable-model-invocation: true
---
Le mod flow-board aurait dû répondre à cette commande à ta place : il n'est pas chargé dans cette session. Dis à l'utilisateur que le tableau de bord flow-board n'est pas actif (mod non installé, désactivé, ou function hooks coupés), et comment le faire revenir quand il était là (après la synchro d'une livraison, par exemple) : taper `/reload-plugins`, puis écrire un message (« reprends ») ; l'outil `flow` ne revient qu'au tour suivant. Si cette discussion porte une mission flow-board, envoie aussi la notification `PushNotification` (outil différé : le charger d'abord par ToolSearch, `select:PushNotification`) au texte fixé « Mission <titre> : outil flow absent », et rien d'autre dans son texte, une fois par absence : pas de nouvelle tant que l'outil n'est pas revenu (règle « Outil flow absent en mission » de flow-board). Ne fais rien d'autre.
