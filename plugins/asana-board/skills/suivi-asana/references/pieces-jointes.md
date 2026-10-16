# Joindre un fichier à une tâche via Chrome

Le connecteur Asana lit les pièces jointes (`get_attachments`) mais ne les téléverse pas. On passe par l'extension Claude in Chrome.

## Préalables

- Outils `claude-in-chrome` chargés : `ToolSearch` « chrome file_upload navigate find ».
- Le fichier doit être partagé avec la session (pièce jointe de la conversation, dossier outputs ou uploads, dossier connecté). Sinon `file_upload` le refuse : bascule sur le repli.
- Taille totale par appel `file_upload` : moins de 10 Mo.
- La tâche existe déjà (créée par le connecteur) et on a son `permalink_url`.

## Étapes

1. `tabs_context_mcp` pour obtenir un onglet, sinon `tabs_create_mcp`.
2. `navigate` vers le `permalink_url` de la tâche. Si Asana affiche un écran de connexion, arrête : l'utilisateur se connecte lui-même (Claude ne saisit pas de mot de passe).
3. `find` « champ fichier pour joindre une pièce jointe à la tâche » (input de type file, souvent masqué). Ne clique pas sur le bouton trombone : il ouvre un sélecteur natif inaccessible.
4. `file_upload` avec `paths` (chemins absolus), `ref` renvoyé par `find`, `tabId`.
5. Capture d'écran (`computer`, action screenshot) pour voir le fichier dans le volet de la tâche.
6. Contrôle côté API : `get_attachments` sur la tâche ; le nom du fichier doit apparaître.

Pour une capture d'écran prise par Claude (pas un fichier), `upload_image` avec l'`imageId` d'une capture récente remplace `file_upload`.

## Repli

Si une étape échoue : écris dans la description de la tâche le chemin du fichier (ex. `<dossier du projet>/livrables/requetes.sql`) ou le lien de l'artifact, et note dans le compte rendu « pièce jointe non ajoutée : raison ».
