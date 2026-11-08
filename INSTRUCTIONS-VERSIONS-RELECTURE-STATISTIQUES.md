# Demande de mise en œuvre : versions du catalogue, relecture et statistiques par année

Ce document est une demande à lancer ultérieurement. **Ne pas commencer les modifications avant que le propriétaire du projet ne le demande explicitement.** La demande couvre une évolution importante : avancer par étapes, protéger les données et ne pas basculer le catalogue public avant validation. Le retour arrière est un critère obligatoire : ne pas mettre en production une étape si sa procédure de retour arrière n’a pas été écrite, testée et comprise.

## Résultat attendu

Ajouter à l’application existante un mécanisme facultatif permettant aux administrateurs de créer, quand ils le décident, une copie complète du catalogue à faire relire au moyen d’un lien sécurisé, sans créer de compte relecteur. Une version approuvée pourra être publiée explicitement. Après publication, l’ancienne version ne sera plus publique mais restera archivée.

Cette relecture concerne les versions annuelles du catalogue, pas les mises à jour de routine : pendant l’année, les administrateurs doivent continuer à ajouter ou modifier des formations et des sessions comme aujourd’hui, sans lancer une nouvelle relecture complète.

Ajouter également une sélection d’année aux statistiques de l’administration, sans retirer ni altérer les indicateurs actuels.

## État actuel à respecter

Le projet est une application web statique utilisant Firebase Authentication et Firestore.

- `index.html` est l’entrée du catalogue public. Il affiche les actualités, les formations et les dates/informations à retenir et propose un lien vers `calendrier.html`. Son affichage est alimenté par `public.js`.
- `calendrier.html` et `calendar.js` présentent les sessions datées. Ils doivent afficher les mêmes données publiques cohérentes que le catalogue.
- `admin.html` et `app.js` gèrent les formations, les dates à retenir, les paramètres, les annonces, le calendrier des lieux et les statistiques.
- Les données existantes comprennent notamment `trainings`, `trainingCategories`, `trainingLocations`, `trainingContacts`, `importantInformation`, `importantInformationCategories` et d’autres collections déjà utilisées. Inspecter le code pour établir le périmètre exact des données nécessaires à une copie fidèle.
- Les règles actuelles de `firestore.rules` autorisent les comptes administrateurs `luc.cesbron@sdis53.fr` et `formation@sdis53.fr` à gérer les collections de catalogue. **Ces deux comptes conservent leurs droits actuels.** Ne pas élargir ni restreindre leurs droits existants sans nécessité démontrée et expliquée.
- Il n’y aura pas de compte relecteur. L’accès à la page dédiée se fera au moyen d’un lien avec code généré par l’application et transmis aux relecteurs par les administrateurs hors application. Ne pas envoyer de courriels automatiquement.
- Les statistiques actuelles de l’administration comprennent les formations, sessions, jours cumulés par domaine et jours d’utilisation par lieu. Les règles de calcul et la distinction des domaines décrites dans `README.md` sont à préserver, après vérification du code réel.
- Ne pas confondre cette fonctionnalité avec `agent-calendar.html` et ses données/règles propres.

Les fichiers ci-dessus sont des points d’entrée à vérifier, pas une liste exhaustive. Avant toute modification, rechercher tous les consommateurs et producteurs des données concernées, notamment les PDF, le service worker/cache, les règles, les pages publiques, l’administration et les éventuelles fonctions serveur.

## 1. Préparation et protection de l’existant

Avant de coder :

1. Examiner les structures Firestore réellement utilisées et les formats de dates des sessions, y compris les sessions dans les phases.
2. Cartographier précisément toutes les collections et références requises pour afficher le catalogue complet, dans `index.html`, `calendrier.html`, les fiches détaillées et les PDF.
3. Vérifier comment les mises à jour courantes sont enregistrées, et comment l’administration détermine les autorisations.
4. Prévoir et vérifier une sauvegarde Firestore restaurable avant toute migration ou opération pouvant toucher les données existantes. Un export local non vérifié ne vaut pas preuve de sauvegarde.
5. Présenter une approche de migration et de retour arrière avant d’effectuer une opération non additive ou une bascule du public.

Ne pas considérer un export local comme un reflet garanti de la production. Ne pas déployer sur Firebase ou Cloudflare, modifier des données de production, créer des comptes ou publier des secrets sans autorisation explicite.

## 1a. Retour arrière obligatoire

Il est impossible de promettre qu’une évolution ne contiendra aucun bug. La mise en œuvre doit donc permettre de revenir à un état connu sans perdre les données déjà présentes ni les mises à jour faites depuis le lancement.

Avant le premier déploiement en production, préparer et documenter **deux retours arrière distincts** :

1. **Code et configuration** : conserver le commit Git de référence avant changement, développer sur une branche dédiée et identifier précisément comment redéployer la version précédente de l’hébergement, des règles Firestore et de toute fonction serveur/Worker touchée. Ne pas écraser ou amender le commit de référence.
2. **Données** : effectuer une sauvegarde de production avant toute opération sur les données, puis vérifier concrètement qu’elle peut être restaurée dans un environnement isolé. Documenter qui peut la restaurer et les conséquences de restauration. Une sauvegarde qui n’a jamais été restaurée/testée n’est pas considérée comme suffisante.

Exigences pour rendre ces retours possibles :

- Garder les collections et chemins actuellement utilisés en place pendant la migration. Toute nouvelle structure doit d’abord être ajoutée à côté; aucune migration destructive, suppression ou renommage de collection dans la première étape.
- Garder le catalogue actuel comme chemin de lecture de secours. La mise en service doit être activable/désactivable par une configuration explicite, initialement désactivée, et le retour au chemin antérieur ne doit pas nécessiter de modifier manuellement chaque formation.
- Un retour de code seul ne suffit pas si le schéma ou les données ont changé. Vérifier la compatibilité des versions précédentes avec les nouvelles règles et données; si nécessaire, préparer une séquence de restauration des règles/configurations et des données.
- Ne pas écraser les données courantes avec une archive pour « revenir en arrière ». Un retour à une version précédente doit changer de façon contrôlée la version publique active, préserver les ajouts faits après publication et signaler les conflits. Décrire le traitement des changements postérieurs au point de retour.
- Ne pas utiliser une restauration complète de Firestore comme premier réflexe de retour arrière : elle peut effacer les écritures légitimes intervenues depuis la sauvegarde. Privilégier la désactivation du nouveau chemin ou le retour du pointeur public, et ne restaurer les données qu’après analyse et autorisation explicite.
- Avant production, répéter sur un projet Firebase de test (ou un environnement isolé équivalent) au minimum : déploiement, publication d’une version, retour au catalogue précédent, et retour du code/règles antérieurs. Vérifier ensuite les pages publiques, l’administration et les écritures.
- Définir un point d’arrêt/annulation pour chaque étape de déploiement. Si une vérification échoue, interrompre la suite et revenir à la dernière étape stable; ne pas continuer en espérant corriger plus tard.
- Après déploiement autorisé, vérifier immédiatement `index.html`, `calendrier.html`, l’administration, les règles d’accès et les mises à jour de formations/sessions. Si une vérification échoue, appliquer la procédure documentée et confirmer le rétablissement.

Le dossier de livraison doit inclure une procédure courte et exécutable de retour arrière, les versions/commits à restaurer, les contrôles à refaire, les données qui pourraient être perdues et les cas où il faut s’arrêter et demander une décision. Ne pas affirmer que le retour arrière est garanti si ces étapes n’ont pas été testées.

## 2. Versions de relecture isolées

- Ajouter dans l’administration une action explicite **« Créer une version de relecture »**. La création est déclenchée uniquement quand un administrateur le décide.
- Créer une copie cohérente des données nécessaires au catalogue, au minimum les formations et leurs catégories, les dates à retenir et leurs catégories. Inclure les autres données référencées nécessaires à un affichage fidèle, après inventaire.
- Garder cette copie dans un espace distinct des données publiques actives. Les éditions du brouillon, les changements d’ordre et les corrections ne doivent jamais modifier le catalogue public.
- Reproduire fidèlement les identifiants/références nécessaires, ou adapter de façon sûre les références internes à la copie. Ne pas laisser une version afficher silencieusement des données provenant de la version publique courante.
- Prévoir plusieurs versions et empêcher qu’une version ancienne ou en conflit écrase des modifications plus récentes. Détecter les conflits et demander une action explicite; ne jamais fusionner, écraser ou supprimer silencieusement.
- Conserver un historique minimal : année/nom de version, état, auteur, horodatages, soumission, commentaires, décision, publication et archivage.
- États possibles à adapter au design retenu : brouillon, en relecture, corrections demandées, approuvée, publiée, archivée, annulée.
- Une modification d’une version soumise invalide la relecture précédente. Il faut une nouvelle soumission et une nouvelle décision.

## 3. Lien sécurisé et page de relecture

- Créer une page dédiée, distincte de `admin.html`, destinée uniquement à la consultation et aux actions de relecture.
- Générer un code à forte entropie, imprévisible et propre à une seule version. Le lien doit pouvoir être partagé manuellement par courriel.
- Le code est un secret porteur : quiconque le détient peut accéder à la relecture. Le dire clairement aux administrateurs et aux relecteurs; ne pas prétendre qu’il identifie la personne qui l’utilise.
- Le code ne doit donner aucun accès à l’administration, à d’autres versions, aux collections publiques non nécessaires ou aux données du calendrier des agents.
- Ne pas sécuriser la page en se contentant de masquer des éléments, de vérifier le code uniquement dans le JavaScript client, ou d’accorder la lecture publique aux documents de relecture.
- Faire vérifier le code et l’état actif de la version dans une couche serveur de confiance, compatible avec les services Firebase effectivement disponibles. La consultation et les actions doivent passer par cette couche. Les règles Firestore doivent continuer à bloquer l’accès direct non autorisé.
- Ne jamais stocker le code en clair dans Firestore, les journaux ou les rapports d’erreur. Évaluer les risques d’exposition du code dans l’URL, l’historique du navigateur, les journaux HTTP et les référents; appliquer des mesures adaptées, par exemple échange du code contre une session limitée, limitation de débit et absence de transmission à des tiers.
- Permettre de révoquer un lien. Le contrôle de révocation doit être appliqué côté serveur; après publication ou annulation, le lien devient inutilisable.
- Permettre au relecteur de consulter la copie et de transmettre un commentaire ou de demander des corrections. L’approbation doit être une action explicite sur cette page, si elle est retenue comme étape du circuit. Si plusieurs relecteurs utilisent le même lien, expliquer que le lien ne permet pas de distinguer leur identité.
- Afficher les états et confirmer les actions. Présenter une erreur explicite si le lien est invalide, révoqué, expiré ou lié à une version déjà publiée.

## 4. Publication, archive et modifications courantes

- Tant que la nouvelle version est créée, éditée ou relue, `index.html` et `calendrier.html` continuent d’afficher les données actives actuelles, inchangées.
- Après validation du relecteur, la publication nécessite une action explicite d’un administrateur existant.
- Basculer le catalogue et le calendrier de manière cohérente. Éviter qu’un lecteur voie un mélange de versions ou une mise à jour partielle entre collections. Choisir et documenter une stratégie atomique ou une stratégie avec pointeur de version publiée; traiter les limites/quotas Firestore.
- Après réussite de la publication, la nouvelle version est la version publique, l’ancienne n’est plus affichée et est conservée en archive, pas supprimée définitivement. Prévoir un retour arrière vérifié vers une archive.
- Désactiver le lien de la version publiée et refuser son utilisation ultérieure côté serveur.
- Préserver les ajouts et modifications courants de formations/sessions sans relecture complète. Ils doivent continuer à suivre le circuit d’administration actuel après publication.
- Définir explicitement ce qui se passe si des modifications courantes sont faites pendant qu’un brouillon ou une relecture existe : détecter les écarts et empêcher la publication d’une copie obsolète qui écraserait ces changements. Proposer une actualisation contrôlée de la copie ou une résolution de conflit, sans perte de données.
- Vérifier si les annonces et les autres contenus éditoriaux font partie de la version annuelle ou restent hors de son périmètre. Ne pas modifier leur comportement actuel par supposition.

## 5. Statistiques par année

- Ajouter un sélecteur d’année dans l’onglet Statistiques de l’administration.
- Préserver les métriques et agrégations actuelles : formations, sessions, jours cumulés par domaine, jours par lieu, et leurs filtres/comportements existants.
- Calculer les résultats pour l’année sélectionnée à partir des dates réelles des sessions, en incluant les sessions directes et celles des phases. Vérifier d’abord le format réel des dates et les règles existantes.
- Une session couvrant plusieurs années contribue aux jours de chaque année qu’elle couvre, sans double comptage. Une formation avec des sessions sur plusieurs années peut apparaître dans les résultats de chacune de ces années.
- Définir clairement comment compter une « formation » dans l’année : formation ayant au moins une session cette année, sans compter plusieurs fois la même formation dans les totaux si elle a plusieurs sessions.
- Traiter explicitement les sessions sans date : ne pas leur attribuer une année arbitraire; les exclure du filtre annuel ou les signaler dans une zone distincte.
- Ne pas compter une archive en plus de la version active pour créer des doublons. Définir si les statistiques historiques décrivent les données actuellement connues pour une année ou l’état du catalogue tel qu’il était publié à l’époque; retenir et documenter une seule sémantique cohérente.
- Afficher un état vide clair pour une année sans session. Ne pas changer les statistiques annuelles du calendrier des agents, qui sont indépendantes.

## 6. Déploiement progressif

1. Créer un point de référence dans Git et un environnement de test séparé. Mettre en place et tester les nouvelles collections et règles sans changer les lectures/écritures du catalogue actuel.
2. Tester la création, la copie, le lien et la page dédiée sur des données de test.
3. Vérifier les droits des deux administrateurs existants ainsi que les refus d’accès directs et indirects.
4. Tester les scénarios d’échec et répéter la procédure complète de retour arrière, données et code/configuration compris, dans l’environnement de test.
5. Ne faire basculer `public.js` ou `calendar.js` vers une version publiée qu’après validation de la cohérence des données et des tests, et seulement si le retour arrière correspondant a été validé.
6. Documenter les étapes manuelles de configuration, de déploiement et de retour arrière. Laisser tout déploiement de production à une autorisation distincte.

Conserver une voie de retour vers le fonctionnement antérieur jusqu’à ce que la nouvelle lecture publique soit confirmée en production. La fin de la période d’observation et le retrait éventuel de l’ancien chemin nécessitent une décision séparée; ne pas supprimer la voie de retour automatiquement.

## Critères d’acceptation

- Les comptes `luc.cesbron@sdis53.fr` et `formation@sdis53.fr` gardent les droits actuels.
- Créer ou modifier une copie ne change ni le catalogue de `index.html`, ni le calendrier public, ni les PDF actuels.
- Le lien ne permet d’accéder qu’à la version visée, ne donne aucun accès à l’administration et cesse de fonctionner après révocation/publication.
- Les règles Firestore et la couche serveur refusent les accès non autorisés; la sécurité n’est pas uniquement assurée par l’interface.
- Les soumissions, demandes de corrections, approbations, invalidations après modification et publications respectent le workflow.
- L’ancienne version est archivée, masquée du public et récupérable; elle n’est pas supprimée définitivement.
- Une erreur durant la publication laisse un catalogue public cohérent, et le retour arrière est opérationnel.
- Le retour arrière du code, des règles et des données a été répété avec succès en environnement isolé; sa procédure et ses limites sont livrées.
- Le retour au catalogue précédent ne supprime pas les mises à jour courantes intervenues après publication; les conflits sont détectés et traités explicitement.
- Les ajouts et modifications courants de formations/sessions continuent de fonctionner sans nouvelle relecture annuelle.
- Les statistiques affichent les indicateurs existants par année, y compris les sessions dans les phases et celles chevauchant deux années, sans double comptage.
- Les pages et fonctions existantes non concernées continuent à fonctionner.
- Exécuter les tests ciblés, contrôles de syntaxe/build et tests de règles disponibles. Signaler les limites des tests; ne pas déclarer la sécurité vérifiée par de seuls tests d’interface.

## Livrable de la future intervention

Mettre en œuvre la fonctionnalité de bout en bout avec modifications limitées et documentation actualisée. Fournir un résumé des fichiers modifiés, des décisions de conception, des tests exécutés et résultats, des risques résiduels, des opérations manuelles nécessaires et une procédure de retour arrière testée. Ne pas effectuer de déploiement en production ni de migration de données sans autorisation explicite.
