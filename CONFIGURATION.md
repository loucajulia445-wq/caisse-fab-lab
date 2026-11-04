# Mise en ligne et synchronisation de la caisse

La caisse fonctionne sur ordinateur, tablette et smartphone. Pour partager le
même stock et les mêmes ventes entre appareils, elle doit être publiée sur un
site HTTPS et connectée à un projet Supabase. Sans cette configuration, elle
reste en mode local, avec des données séparées par navigateur.

## 1. Créer la base de données

1. Le projet de cette caisse est `tqzgylltwefqusbbjovj.supabase.co`.
2. Dans **SQL Editor**, exécutez le contenu de `supabase/setup.sql`. Cette
   opération crée les tables privées, le code PIN initial `1234` et la
   protection contre les tentatives de connexion répétées.
   Si ce script a déjà été exécuté sur le projet, ne le relancez pas.

## 2. Déployer l’API sécurisée

Installez la CLI Supabase, ouvrez un terminal à la racine de ce dossier, puis
exécutez :

```text
supabase login
supabase link --project-ref tqzgylltwefqusbbjovj
supabase functions deploy caisse
```

La clé `service_role` est utilisée uniquement par Supabase côté serveur. Ne la
copiez jamais dans `index.html`, `supabase-config.js` ou un message.

## 3. Connecter l’application au projet

L’URL et la clé publishable du projet sont déjà renseignées dans
`supabase-config.js`. Après le déploiement de la fonction, republiez ce fichier
avec `index.html` sur votre hébergement HTTPS.

Le dossier `supabase/` sert au
déploiement de la fonction et n’a pas à être publié comme site web.

## 4. Première connexion

Ouvrez l’adresse HTTPS de votre caisse et connectez-vous avec le PIN initial
`1234`. Dans **Ma boutique**, changez-le immédiatement pour un code personnel.
Le PIN est stocké haché sur le serveur et les sessions expirent après 12 heures.
Après connexion, le premier appareil initialise le catalogue et les données
locales existantes dans le cloud. Les appareils suivants chargent ces données.

La synchronisation s’actualise automatiquement environ toutes les 15 secondes.
En cas de modification simultanée sur deux appareils, la caisse recharge la
dernière version enregistrée et demande de vérifier avant de recommencer.

## 5. Imprimer sur une imprimante thermique USB

Branchez l’imprimante sur l’ordinateur et installez son pilote Windows (fourni
par le fabricant ou via Windows Update). Dans **Ma boutique**, choisissez un
rouleau de 58 ou 80 mm, puis cliquez sur **Imprimer un ticket de test**.
Dans la fenêtre d’impression du navigateur, sélectionnez l’imprimante USB et
choisissez le même format de papier dans les préférences du pilote.

L’impression passe par le navigateur et le pilote du système : elle ne dépend
pas de la marque, tant que Windows reconnaît l’imprimante. Une application web
ne peut pas communiquer directement avec tous les périphériques USB de façon
universelle. Les imprimantes qui exigent un logiciel ou un pilote spécifique
doivent donc être configurées dans Windows avant l’impression.

## 6. Gérer la TVA

Les prix de vente saisis restent **TTC** : le montant facturé au client ne
change pas. Dans le formulaire de chaque produit, choisissez son taux de TVA
(20 % par défaut, ou 10 %, 5,5 %, 2,1 % ou 0 %). Vérifiez le taux applicable à
chaque produit selon votre situation.

Les nouveaux tickets affichent les bases HT et la TVA par taux, ainsi que les
totaux HT, TVA et TTC. L’historique et l’export CSV indiquent aussi la TVA
collectée. Les tickets enregistrés avant l’activation de cette fonction ne
sont pas recalculés rétroactivement.
