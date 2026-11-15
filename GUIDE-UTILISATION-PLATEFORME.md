# Mode d’emploi de la plateforme de formations

Ce guide s’adresse aux administrateurs qui gèrent le catalogue, ses paramètres et les communications avec les utilisateurs. Les libellés cités correspondent à l’administration actuelle.

## 1. Se connecter

1. Ouvrez la page d’administration (`admin.html`) et connectez-vous avec un compte administrateur autorisé.
2. Si l’adresse e-mail n’est pas encore vérifiée, ouvrez le lien reçu par e-mail, puis reconnectez-vous.
3. La barre en haut de la page permet d’ouvrir le catalogue public, la gestion des **Versions et relecture** ou de se déconnecter.

Les modifications du catalogue courant sont enregistrées dans le catalogue public. Pour préparer une nouvelle édition sans modifier le catalogue en ligne, utilisez le mode **Versions et relecture** décrit à la section 7.

## 2. Ajouter ou modifier une formation

1. Ouvrez l’onglet **Formations**.
2. Cliquez sur **+** pour ajouter une formation, ou sur l’icône crayon de la formation à modifier.
3. Renseignez les champs utiles :
   - **Identifiant** et **Intitulé** ;
   - **Catégorie** et, si nécessaire, **Sous-catégorie** ;
   - résumé, durée, formations prérequises, prérequis et observations ;
   - une ou plusieurs **sessions**, éventuellement regroupées en **phases** ;
   - le contact.
4. Pour une session, précisez notamment son nom éventuel, ses dates et son lieu. Une session peut être annulée avec le bouton prévu à cet effet et accompagnée d’un motif. Le bouton corbeille supprime la session de la fiche ; l’annulation, elle, conserve la session et son état.
5. Cliquez sur **Enregistrer**. Vérifiez ensuite la fiche dans le catalogue avec **Voir le catalogue**.

Les formations sont publiées par défaut à leur création. L’icône œil permet de masquer une formation sans la supprimer ; elle disparaît alors du catalogue et du calendrier publics. L’icône œil barré permet de la réafficher.

Pour réordonner les formations, faites glisser leur poignée dans la liste. Une formation peut aussi être supprimée avec la corbeille, puis confirmation : cette suppression est définitive. Préférez le masquage si vous pensez pouvoir la réutiliser.

## 3. Gérer les catégories et sous-catégories

1. Ouvrez **Paramétrage**, puis **Catégories et sous-catégories**.
2. Cliquez sur **+** pour créer une catégorie, saisissez son nom et choisissez sa couleur.
3. Pour ajouter une sous-catégorie, cliquez sur le **+** associé à la catégorie concernée, puis indiquez son nom et sa couleur.
4. Utilisez le crayon pour renommer une catégorie ou une sous-catégorie et modifier sa couleur. Un renommage met également à jour les formations qui l’utilisent.
5. Utilisez les poignées pour réordonner les catégories ou sous-catégories.
6. La corbeille supprime l’élément après confirmation. Une catégorie ou une sous-catégorie utilisée par des formations ne peut pas être supprimée : réaffectez d’abord ces formations ou supprimez-les.

Lors de la création ou modification d’une formation, choisissez d’abord la catégorie ; la liste des sous-catégories proposées dépend de ce choix.

## 4. Gérer les lieux et les contacts

Ouvrez **Paramétrage** :

- Dans **Lieux**, cliquez sur **+**, saisissez le nom du lieu, puis enregistrez. Les lieux disponibles sont proposés dans les sessions et utilisés par le calendrier des lieux.
- Dans **Contacts**, cliquez sur **+**, saisissez le nom obligatoire et, si vous le souhaitez, une adresse e-mail et un téléphone. Le contact peut ensuite être choisi dans une formation.
- Le crayon permet de modifier une fiche ; la corbeille la supprime après confirmation.

Avant de supprimer un lieu ou un contact, vérifiez les formations qui le référencent et remplacez-le si nécessaire. Après une modification, contrôlez les fiches concernées.

## 5. Publier une annonce ou envoyer une notification

Ouvrez **Annonces & Notifications**. Ces deux fonctions ne sont pas équivalentes.

### Annonce du catalogue

1. Dans **Annonces**, cliquez sur **+**.
2. Saisissez le titre, le message et le type (**AJOUT**, **ANNULATION**, **MODIFICATION** ou **INFORMATION**).
3. Cliquez sur **Enregistrer**.

L’annonce est conservée et affichée dans le catalogue. À la création, la plateforme tente aussi d’envoyer une notification aux appareils Android abonnés. Modifier une annonce existante ne déclenche pas un nouvel envoi. La suppression de l’annonce ne peut pas retirer une notification déjà reçue.

### Notification ponctuelle

1. Dans **Envoyer une notification**, saisissez le **Titre** et le **Texte**.
2. Cliquez sur **Envoyer la notification** et vérifiez le message de résultat affiché.

Cette notification est envoyée aux appareils Android abonnés, mais n’ajoute pas d’annonce au catalogue. Elle n’est pas conservée dans un historique. Le résultat confirme l’acceptation par FCM ; il ne donne pas le nombre d’appareils effectivement notifiés.

Si l’envoi échoue, l’administration affiche une erreur. Vérifiez la configuration du service de notifications ou contactez la personne qui l’administre ; ne répétez pas l’envoi sans vérifier si le premier a pu aboutir.

## 6. Contrôler le résultat

- Utilisez **Voir le catalogue** pour contrôler les formations et annonces telles qu’elles sont présentées au public.
- Vérifiez les détails d’une formation, ses sessions, son contact et les dates dans le calendrier.
- Pour une formation que vous ne voulez plus afficher, masquez-la plutôt que de la supprimer.
- Après un changement de catégorie, lieu ou contact, contrôlez les éléments qui s’y réfèrent.

## 7. Créer une version à relire avec des relecteurs

Pour une nouvelle édition annuelle, ouvrez **Versions et relecture** dans la barre de compte de l’administration.

1. Saisissez l’année du catalogue, le nom de la version et le nom du premier relecteur, puis cliquez sur **Créer une copie de relecture**.
2. Copiez le lien de relecture affiché et transmettez-le au relecteur concerné. Le lien est affiché une seule fois à sa création ; conservez-le de façon sûre. Toute personne qui possède ce lien peut l’utiliser.
3. Cliquez sur **Modifier cette copie** pour préparer la version. Vérifiez le bandeau de la copie avant toute modification : les changements faits dans cette copie ne modifient pas le catalogue public. Vous pouvez ajuster les formations, catégories, lieux, contacts et dates à retenir.
4. Ajoutez les autres relecteurs depuis la carte de la version et transmettez à chacun son lien individuel.
5. Lorsque la copie est prête, cliquez sur **Soumettre à la relecture**. Les relecteurs peuvent envoyer des commentaires généraux ou liés à une formation et valider la version en l’état. Leurs validations ne bloquent pas la publication.
6. Consultez les commentaires et répondez si nécessaire. Pour reprendre les modifications, cliquez sur **Terminer les retours et modifier**, modifiez la copie, puis choisissez **Renvoyer en relecture**.
7. Lorsque vous décidez que la version est prête, l’administrateur peut la publier. La publication remplace le catalogue public et archive le catalogue précédent.

La copie est un instantané : les changements réalisés ensuite dans le catalogue courant ne sont pas ajoutés automatiquement à la version. Pour les statuts, la réinitialisation d’un lien perdu, la suppression d’une version et les autres détails du circuit, consultez [TUTO-RELECTURE-CATALOGUE.md](./TUTO-RELECTURE-CATALOGUE.md).

## À retenir

- **Masquer** une formation est réversible ; **supprimer** une formation est définitif.
- Une annonce publiée et une notification ponctuelle sont deux opérations différentes.
- Une version à relire est séparée du catalogue public jusqu’à sa publication.
- La publication d’une version relève de l’administrateur, pas des relecteurs.
