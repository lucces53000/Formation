# Tutoriel — créer, modifier et soumettre une version en relecture

Ce tutoriel décrit le circuit depuis l’administration. Une version est une copie de travail séparée du catalogue public : la modifier ne change pas les données actuellement publiées.

## 1. Ouvrir la page dédiée et créer une version

1. Connectez-vous à l’administration avec un compte administrateur autorisé.
2. Dans la barre de compte, cliquez sur **Versions et relecture**. La gestion des versions est sur une page séparée des onglets d’administration courants.
3. Renseignez l’année du catalogue, le nom de la version et le nom du premier relecteur, puis cliquez sur **Créer une copie de relecture**.
4. La version apparaît dans la liste à l’état **Brouillon**. Le lien individuel du premier relecteur est affiché une seule fois.

La copie reprend le catalogue tel qu’il est au moment de sa création. Les changements effectués ensuite dans le catalogue habituel ne sont pas ajoutés automatiquement à cette copie.

## Supprimer une version non publiée

Sur la page dédiée, cliquez sur **Supprimer cette version** puis confirmez. Cela supprime définitivement la copie, ses liens de relecture et les commentaires associés, y compris si elle est en cours de relecture, approuvée ou à corriger. Les liens cessent de fonctionner dès le début de la suppression. Le catalogue public et les archives ne sont pas modifiés.

Une version publiée ne peut pas être supprimée par cette action. Si la suppression est interrompue, la carte indique **Suppression en cours** : cliquez sur **Reprendre la suppression** pour terminer. La suppression n’est pas annulable ; utilisez une sauvegarde Firestore si une restauration devient nécessaire.

## 2. Modifier la copie sans toucher au catalogue public

1. Sur la page **Versions et relecture**, dans la carte de la version, cliquez sur **Modifier cette copie**.
2. La page d’administration s’ouvre en mode isolé. Vérifiez le bandeau qui indique le nom de la copie en cours de modification.
3. Ajoutez, modifiez, masquez ou supprimez les formations et les dates à retenir comme dans l’administration habituelle. Ces actions s’appliquent à la copie tant que ce bandeau est présent.
4. Les onglets **Calendrier**, **Annonces & Notifications** et les réglages de maintenance du site ne sont pas proposés dans ce mode. Les formations, dates à retenir, catégories, lieux et contacts sont ceux de la copie.
5. Cliquez sur **Retour aux versions et relecture** pour revenir à la page de gestion. Ne retournez pas au catalogue courant pour continuer à modifier la copie.

Avant chaque modification, vérifiez le bandeau afin de confirmer si vous travaillez dans la copie ou dans le catalogue courant.

## 3. Gérer les relecteurs et soumettre la version

1. Sur la carte de la version, ajoutez si nécessaire d’autres relecteurs en indiquant leurs noms.
2. Chaque relecteur reçoit un lien distinct. Copiez le lien qui vient d’être créé et transmettez-le uniquement à la personne concernée.
3. Cliquez sur **Soumettre à la relecture** et confirmez. La copie est alors figée pendant la collecte des commentaires et son état devient **En relecture**.

Un lien n’est affiché qu’une seule fois à sa création : copiez-le avant de fermer ou d’actualiser la page. Pour des raisons de sécurité, un lien existant ne peut pas être récupéré depuis l’administration. Si le relecteur l’a perdu, ouvrez sa section et cliquez sur **Réinitialiser le lien** : un nouveau lien est créé et l’ancien est immédiatement désactivé. Transmettez le nouveau lien au relecteur. Ses commentaires déjà transmis sont conservés. Aucun compte de relecteur n’est requis. Le nom indiqué sert à attribuer les retours, mais n’est pas vérifié : toute personne détenant le lien peut l’utiliser.

La page de relecture reprend la présentation et l’ordre du catalogue public : catégories dans leur ordre configuré, puis formations dans leur ordre de catalogue, avec la sous-catégorie affichée sur chaque carte. Le résumé des formations n’est pas affiché dans cette page. Les dates sont présentées au format **JJ-MM-AAAA**. Un relecteur peut envoyer un commentaire général et plusieurs commentaires facultatifs, chacun associé à une formation. Il peut aussi cliquer sur **Valider cette version**, puis confirmer dans la fenêtre qui s’ouvre. Cette action signifie qu’il valide la copie dans son état actuel ; elle est enregistrée et visible par l’administration et les autres relecteurs. Elle ne constitue pas un veto et n’empêche pas l’administrateur de publier. Les commentaires sont attribués au nom associé à son lien, mais ce nom n’est pas une identité vérifiée. Tous les relecteurs ayant un lien actif vers cette version voient les commentaires et validations des autres.

## 4. Consulter les retours et modifier la copie

Sur la carte de la version, ouvrez la section d’un relecteur pour consulter ses commentaires et répondre à chacun si nécessaire. La page d’administration reçoit automatiquement les changements de versions en cours de préparation ou de relecture, les nouveaux commentaires, réponses et validations, sans rechargement. Le résumé affiche le nombre de relecteurs, validations et commentaires ; le champ de recherche filtre les versions par nom, année, statut ou relecteur. Les sections ouvertes et les réponses en cours de rédaction restent conservées lors de l’actualisation. Les réponses sont visibles par les relecteurs à l’ouverture ou à l’actualisation de leur page. Sur leur page, les relecteurs voient les discussions générales et celles associées à chaque formation, avec les réponses de l’administration. La page conserve son lien lors d’un rechargement ; le bouton **Actualiser les commentaires** permet aussi de récupérer les nouveaux retours sans recharger toute la copie.

Quand vous êtes prêt à modifier la copie, cliquez sur **Terminer les retours et modifier**. Les liens sont temporairement désactivés, mais les commentaires sont conservés. Cliquez sur **Modifier cette copie**, appliquez les changements, puis cliquez sur **Renvoyer en relecture** pour rouvrir les liens actifs et demander un nouveau tour.

Vous pouvez ajouter un relecteur en cours de relecture. Vous pouvez aussi supprimer un relecteur : son lien est immédiatement révoqué et ses commentaires déjà envoyés restent visibles.

## 5. Publier la version

La publication est une décision de l’administrateur. Aucun relecteur ne peut approuver, refuser ou bloquer la publication. L’administrateur peut publier une version soumise à la relecture même si des commentaires ont été envoyés ou si certains relecteurs n’ont pas répondu. Cliquez sur **Publier cette version** pour remplacer le catalogue public et archiver l’ancien catalogue.

## À retenir

- **Brouillon** : la copie peut être modifiée et soumise.
- **Corrections demandées** : la collecte a été terminée par l’administrateur ; lisez les commentaires, modifiez la copie et renvoyez-la.
- **En relecture** : la copie est figée et le lien est actif.
- **Publiée** : les liens de relecture sont désactivés.
- Les ajouts ou corrections courants qui ne nécessitent pas de relecture peuvent toujours être faits directement dans le catalogue courant.
- La publication remplace le catalogue public et archive l’ancien catalogue. Une fois publiée, la relecture de cette version est désactivée.
