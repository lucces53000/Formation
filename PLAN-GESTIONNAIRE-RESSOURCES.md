# Plan — Rôle gestionnaire des ressources

## 1. Objectif

Créer un rôle dédié `Gestionnaire des ressources` capable de :

- consulter les formations, leurs sessions et le calendrier des formations ;
- ajouter des ressources à des sessions sur des plages de dates ;
- consulter les affectations existantes ;
- modifier ou retirer une affectation ;
- consulter les conflits de disponibilité.

Ce rôle ne doit pas pouvoir modifier le catalogue, gérer les versions, publier une formation, envoyer des notifications ou modifier les paramètres du site.

## 2. Page dédiée

Créer une page indépendante, par exemple `resources.html`, avec son propre fichier JavaScript `resources.js` et sa feuille de style `resources.css`.

Cette page est accessible sans exposer les onglets d'administration réservés au catalogue.

Elle contient :

- l'authentification Firebase ;
- un message d'accès refusé pour les comptes non autorisés ;
- un bouton de déconnexion ;
- le calendrier mensuel des sessions ;
- la liste des ressources ;
- le formulaire d'affectation ;
- les affectations en cours ;
- l'historique des modifications.

Le compte `luc.cesbron@sdis53.fr` est autorisé dès la mise en production de la fonctionnalité.

Par la suite, l'autorisation d'autres comptes sera centralisée dans une collection Firestore `resourceManagers`, contenant au minimum :

- `email` ;
- `displayName` ;
- `active` ;
- `createdAt` ;
- `createdBy` ;
- `updatedAt`.

Pour éviter les adresses écrites en plusieurs endroits, l'administrateur principal pourra gérer les utilisateurs autorisés depuis la nouvelle page ou depuis une section réservée à son compte.

La gestion des comptes doit conserver les contraintes suivantes :

- adresse e-mail vérifiée dans Firebase Authentication ;
- adresse normalisée en minuscules ;
- compte actif dans `resourceManagers` ;
- aucune création d'utilisateur directement depuis le navigateur ;
- création préalable du compte Firebase Authentication par l'administrateur, puis ajout de son adresse à la liste autorisée.

L'accès doit être vérifié à la fois dans la page JavaScript et dans `firestore.rules`. Un utilisateur peut être supprimé de la liste pour perdre immédiatement l'accès aux données et aux opérations.

## 3. Modèle des ressources

### Collection `resources`

Chaque ressource contient :

- `name` : nom affiché ;
- `type` : véhicule, salle, matériel, formateur ou autre ;
- `reference` : référence interne facultative ;
- `active` : indique si la ressource peut être affectée ;
- `immatriculation` : immatriculation du véhicule ;
- `cis` : CIS propriétaire du véhicule ;
- `notes` : remarques facultatives ;
- `createdAt` et `updatedAt`.

### Collection `resourceAssignments`

Chaque affectation contient :

- `trainingId` ;
- `sessionId` ;
- `resourceId` ;
- `startDate` ;
- `endDate` ;
- `status` : `planned`, `confirmed` ou `cancelled` ;
- `notes` ;
- `createdBy` ;
- `createdAt` ;
- `updatedBy` ;
- `updatedAt`.

Cette séparation évite de dupliquer les données dans chaque formation et permet de contrôler les conflits sur plusieurs sessions.

## 4. Droits et rôles

Conserver les rôles existants :

- administrateur ;
- administrateur du calendrier des agents ;
- gestionnaire des ressources.

Le compte `luc.cesbron@sdis53.fr` dispose de l'accès dès la mise en production.

Les autres gestionnaires sont enregistrés dans la collection `resourceManagers`, avec une adresse vérifiée et le champ `active` à `true`.

Pour les premières phases de déploiement, les règles Firestore peuvent aussi utiliser une liste e-mail; l'objectif final reste la collection `resourceManagers`.

Un gestionnaire peut :

- lire les formations, catégories, lieux et sessions ;
- lire les ressources ;
- lire, créer, modifier ou annuler les affectations ;
- consulter le calendrier.

Un gestionnaire ne peut pas :

- modifier les formations, catégories, lieux ou contacts ;
- modifier les paramètres publics ;
- gérer les versions ou les relectures ;
- envoyer des notifications ;
- gérer les agents.

Si le nombre d'utilisateurs augmente, remplacer progressivement les listes d'adresses par des `custom claims` Firebase.

## 5. Interface de la page dédiée

La page `resources.html` contient :

- un onglet `Ressources` ;
- une liste filtrable des ressources ;
- un formulaire de création et modification des ressources ;
- un onglet `Affectations` ;
- une vue de calendrier des formations enrichie avec les ressources affectées.

La page peut être ouverte depuis un bouton de l'administration, mais elle reste indépendante et possède son propre contrôle d'accès. Elle peut aussi être ajoutée au menu PWA si les gestionnaires utilisent l'application sur mobile.

Depuis une session du calendrier :

1. ouvrir le détail de la session ;
2. afficher les ressources déjà affectées ;
3. sélectionner une ressource ;
4. vérifier qu’un autre véhicule identique n’est pas déjà réservé ;
5. vérifier les conflits ;
6. confirmer l'affectation.

Le calendrier propose les filtres suivants :

- lieu ;
- type de ressource ;
- ressource précise ;
- état de l'affectation.

Les affectations sont représentées selon leur état : prévue, confirmée ou annulée.

## 6. Disponibilités et conflits

Avant chaque affectation, vérifier :

- que la session existe et n'est pas annulée ;
- que les dates sont incluses dans la plage de la session ;
- que la ressource existe et est active ;
- que le véhicule n'est pas déjà réservé sur les dates demandées ;
- que les affectations annulées ne sont pas prises en compte dans les disponibilités.

Pour éviter les affectations simultanées incompatibles, effectuer les contrôles et écritures dans une transaction Firestore ou une Cloud Function. En cas de conflit, le message indique la formation, la session et les dates pour lesquelles le véhicule est déjà réservé.

## 7. Calendrier

Réutiliser le calendrier mensuel existant dans `admin.html`.

Sur chaque journée :

- afficher les formations ;
- afficher les ressources affectées ;
- utiliser une couleur ou un symbole par type de ressource ;
- distinguer les affectations prévues, confirmées et annulées.

Les détails internes des ressources restent invisibles sur le calendrier public `calendrier.html`. La liste publique peut continuer à n'afficher que les informations déjà prévues.

## 8. Sécurité Firestore

Créer les fonctions suivantes dans `firestore.rules` :

- `isAdmin()` ;
- `isAgentCalendarAdmin()` ;
- `isResourceManager()` ;
- `isVerifiedResourceManager()`.

Limiter les accès :

- lecture des formations : conforme aux règles publiques actuelles ;
- lecture des ressources : administrateurs et gestionnaires des ressources ;
- écriture des ressources : administrateurs et gestionnaires des ressources ;
- affectations : gestionnaires des ressources autorisés ;
- historique : lecture réservée aux administrateurs et gestionnaires.

`isResourceManager()` vérifie :

- que l'utilisateur est authentifié ;
- que son adresse e-mail est vérifiée ;
- que son adresse correspond au compte principal ou à un document actif dans `resourceManagers`.

Seul l'administrateur principal peut créer, modifier ou désactiver les documents `resourceManagers`. La désactivation doit suffire à retirer l'accès ; la suppression du compte Firebase reste facultative.

Toute demande contenant des identifiants non autorisés, des champs inattendus ou des valeurs invalides doit être refusée.

## 9. Historique et traçabilité

Pour chaque modification, conserver :

- l'utilisateur ayant créé l'affectation ;
- l'utilisateur ayant effectué la dernière modification ;
- la date de création ;
- la date de modification ;
- l'état précédent ;
- la raison du retrait ou de l'annulation, si elle est renseignée.

Une collection `resourceAssignmentHistory` peut être utilisée pour conserver les changements sans surcharge dans chaque affectation.

## 10. Ordre de réalisation

1. Valider les types de ressources nécessaires.
2. Créer la page `resources.html`, sa feuille de style et son script.
3. Autoriser `luc.cesbron@sdis53.fr` et préparer la collection `resourceManagers`.
4. Créer les collections Firestore et leurs règles.
5. Ajouter les fonctions de validation et de disponibilité.
6. Ajouter la liste de gestion des ressources dans la page dédiée.
7. Ajouter le formulaire d'affectation depuis une session.
8. Ajouter les contrôles d’unicité du véhicule et les détails des conflits.
9. Enrichir le calendrier des formations.
10. Ajouter l'historique des affectations.
11. Ajouter depuis la page un lien vers cette fonctionnalité depuis `admin.html`.
12. Déployer les règles puis l'hébergement.
13. Effectuer une recette fonctionnelle.

## 11. Recette

Tests fonctionnels minimum :

- un gestionnaire peut consulter les sessions ;
- un gestionnaire peut ajouter une ressource à une session ;
- un gestionnaire ne peut pas modifier le catalogue ;
- une ressource inactive ne peut pas être affectée ;
- une session annulée ne peut pas recevoir une nouvelle affectation ;
- une même ressource ne peut pas être réservée deux fois sur des dates chevauchantes ;
- le message de conflit indique la formation déjà réservataire ;
- une affectation peut être confirmée, retirée ou annulée ;
- les données internes ne sont pas visibles sur le calendrier public ;
- un compte non vérifié ne peut pas accéder aux fonctions réservées ;
- le compte `luc.cesbron@sdis53.fr` peut accéder à la page dédiée ;
- un nouveau compte activé dans `resourceManagers` peut accéder à la page ;
- la désactivation d'un compte retire immédiatement son accès ;
- les affectations restent disponibles après actualisation et reconnexion.
