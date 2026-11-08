# Tutoriel — créer, modifier et soumettre une version en relecture

Ce tutoriel décrit le circuit depuis l’administration. Une version est une copie de travail séparée du catalogue public : la modifier ne change pas les données actuellement publiées.

## 1. Ouvrir la page dédiée et créer une version

1. Connectez-vous à l’administration avec un compte administrateur autorisé.
2. Dans la barre de compte, cliquez sur **Versions et relecture**. La gestion des versions est sur une page séparée des onglets d’administration courants.
3. Renseignez l’année du catalogue et le nom de la version, puis cliquez sur **Créer une copie de relecture**.
4. La version apparaît dans la liste à l’état **Brouillon**.

La copie reprend le catalogue tel qu’il est au moment de sa création. Les changements effectués ensuite dans le catalogue habituel ne sont pas ajoutés automatiquement à cette copie.

## Supprimer une version non publiée

Sur la page dédiée, cliquez sur **Supprimer cette version** puis confirmez. Cela supprime définitivement la copie et son lien de relecture, y compris si elle est en cours de relecture, approuvée ou à corriger. Le lien cesse de fonctionner dès le début de la suppression. Le catalogue public et les archives ne sont pas modifiés.

Une version publiée ne peut pas être supprimée par cette action. Si la suppression est interrompue, la carte indique **Suppression en cours** : cliquez sur **Reprendre la suppression** pour terminer. La suppression n’est pas annulable ; utilisez une sauvegarde Firestore si une restauration devient nécessaire.

## 2. Modifier la copie sans toucher au catalogue public

1. Sur la page **Versions et relecture**, dans la carte de la version, cliquez sur **Modifier cette copie**.
2. La page d’administration s’ouvre en mode isolé. Vérifiez le bandeau qui indique le nom de la copie en cours de modification.
3. Ajoutez, modifiez, masquez ou supprimez les formations et les dates à retenir comme dans l’administration habituelle. Ces actions s’appliquent à la copie tant que ce bandeau est présent.
4. Les onglets **Calendrier**, **Annonces & Notifications** et les réglages de maintenance du site ne sont pas proposés dans ce mode. Les formations, dates à retenir, catégories, lieux et contacts sont ceux de la copie.
5. Cliquez sur **Retour aux versions et relecture** pour revenir à la page de gestion. Ne retournez pas au catalogue courant pour continuer à modifier la copie.

Avant chaque modification, vérifiez le bandeau afin de confirmer si vous travaillez dans la copie ou dans le catalogue courant.

## 3. Soumettre la version et transmettre le lien

1. Revenez à la page dédiée **Versions et relecture**.
2. Sur la carte de la version, cliquez sur **Soumettre à la relecture**.
3. Confirmez la soumission. La copie est alors figée pendant la relecture et son état devient **En relecture**.
4. Après la création de la version, un lien sécurisé s’affiche dans le message de confirmation. Utilisez **Copier le lien** et transmettez-le aux relecteurs par le canal choisi.

Le lien est affiché une seule fois à sa création : conservez-le avant de fermer ou d’actualiser la page. Aucun compte de relecteur n’est requis. La page dédiée permet de consulter les formations et les dates à retenir, puis de choisir **Approuver la version** ou **Demander des corrections**. Une demande de corrections nécessite un commentaire.

## 4. Traiter le retour des relecteurs

### Si des corrections sont demandées

1. Sur la page dédiée, consultez le commentaire affiché sur la carte de la version.
2. Cliquez sur **Modifier cette copie** et effectuez les corrections demandées.
3. Revenez à la carte de la version et cliquez sur **Renvoyer en relecture**.
4. Le lien existant reste utilisable, sauf si vous l’avez révoqué et remplacé.

### Si la version est approuvée

La carte passe à l’état **Approuvée**. L’approbation ne publie pas automatiquement la version : un administrateur doit encore choisir **Publier cette version** pour remplacer le catalogue public.

## 5. Si le lien doit être remplacé

Tant que la version est **En relecture**, cliquez sur **Révoquer et remplacer le lien**, puis confirmez. L’ancien lien cesse immédiatement de fonctionner. Copiez et transmettez le nouveau lien affiché.

## À retenir

- **Brouillon** : la copie peut être modifiée et soumise.
- **Corrections demandées** : lisez le commentaire, modifiez la copie et renvoyez-la.
- **En relecture** : la copie est figée et le lien est actif.
- **Approuvée** : l’administrateur peut publier la version.
- Les ajouts ou corrections courants qui ne nécessitent pas de relecture peuvent toujours être faits directement dans le catalogue courant.
- La publication remplace le catalogue public et archive l’ancien catalogue. Une fois publiée, la relecture de cette version est désactivée.
