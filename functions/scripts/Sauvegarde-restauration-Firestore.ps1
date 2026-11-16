$ErrorActionPreference = "Stop"

$scriptFile = Join-Path $PSScriptRoot "firestore-backup.js"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$dependencyPath = Join-Path $projectRoot "functions\node_modules\firebase-admin"
$defaultProjectId = "id du projet"
$credentialsSetByLauncher = $false

function Wait-ForUser {
  [void](Read-Host "Appuyez sur Entree pour revenir au menu")
}

function Confirm-ProjectId {
  $projectId = Read-Host "Identifiant du projet Firebase"
  if ([string]::IsNullOrWhiteSpace($projectId)) {
    $projectId = $defaultProjectId
  }

  $confirmation = Read-Host "Pour confirmer le projet cible, retapez exactement '$projectId'"
  if ($confirmation -cne $projectId) {
    Write-Host "Confirmation incorrecte. Aucune operation n'a ete lancee." -ForegroundColor Yellow
    return $null
  }

  return $projectId
}

function Select-BackupFile {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Choisir une sauvegarde Firestore"
  $dialog.Filter = "Sauvegardes Firestore (*.json)|*.json|Tous les fichiers (*.*)|*.*"
  $dialog.InitialDirectory = Join-Path $env:USERPROFILE "Documents\FirestoreBackups"
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false

  try {
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
      return $null
    }
    return $dialog.FileName
  } finally {
    $dialog.Dispose()
  }
}

function Set-FirestoreCredentials {
  if (-not [string]::IsNullOrWhiteSpace($env:GOOGLE_APPLICATION_CREDENTIALS)) {
    if (-not (Test-Path -LiteralPath $env:GOOGLE_APPLICATION_CREDENTIALS -PathType Leaf)) {
      throw "GOOGLE_APPLICATION_CREDENTIALS pointe vers un fichier introuvable."
    }
    return
  }

  $adcFile = Join-Path $env:APPDATA "gcloud\application_default_credentials.json"
  if (Test-Path -LiteralPath $adcFile -PathType Leaf) {
    return
  }

  $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($gcloud) {
    Write-Host "Aucun identifiant ADC local n'a ete trouve. Connexion Google Cloud a demarrer."
    & $gcloud.Source auth application-default login
    if ($LASTEXITCODE -ne 0) {
      throw "La connexion gcloud a echoue (code $LASTEXITCODE)."
    }
    if (Test-Path -LiteralPath $adcFile -PathType Leaf) {
      return
    }
    throw "gcloud s'est termine sans creer le fichier ADC attendu."
  }

  Write-Host ""
  Write-Host "gcloud et les identifiants ADC sont absents." -ForegroundColor Yellow
  Write-Host "Vous pouvez installer Google Cloud CLI et vous connecter, ou fournir une cle JSON de compte de service."
  Write-Host "La cle doit appartenir a un compte autorise a administrer Firestore et doit rester secrete."
  $credentialPath = Read-Host "Chemin complet de la cle JSON (Entree pour annuler)"
  if ([string]::IsNullOrWhiteSpace($credentialPath)) {
    throw "Aucun identifiant fourni. Aucune operation Firestore n'a ete lancee."
  }
  if (-not (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
    throw "Le fichier d'identifiants est introuvable."
  }

  try {
    $credential = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
  } catch {
    throw "Le fichier d'identifiants n'est pas un JSON valide."
  }
  if ($credential.type -ne "service_account" -or
      [string]::IsNullOrWhiteSpace($credential.project_id) -or
      [string]::IsNullOrWhiteSpace($credential.private_key)) {
    throw "Le JSON fourni ne semble pas etre une cle de compte de service Google."
  }

  $env:GOOGLE_APPLICATION_CREDENTIALS = (Resolve-Path -LiteralPath $credentialPath).Path
  $script:credentialsSetByLauncher = $true
}

function Invoke-BackupTool {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $script:nodeCommand.Source $script:scriptFile @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "L'outil Firestore s'est termine avec le code $LASTEXITCODE."
  }
}

function Invoke-BackupAction {
  $projectId = Confirm-ProjectId
  if (-not $projectId) { return }

  Set-FirestoreCredentials
  Write-Host ""
  Write-Host "Creation d'une sauvegarde du projet $projectId..."
  Invoke-BackupTool -Arguments @("backup", "--project", $projectId)
}

function Invoke-RestoreAction {
  param([switch]$Apply)

  $projectId = Confirm-ProjectId
  if (-not $projectId) { return }

  $backupFile = Select-BackupFile
  if (-not $backupFile) {
    Write-Host "Aucun fichier selectionne. Aucune operation n'a ete lancee." -ForegroundColor Yellow
    return
  }

  Set-FirestoreCredentials
  Write-Host ""
  if ($Apply) {
    Write-Host "ATTENTION : la restauration peut remplacer et supprimer des donnees." -ForegroundColor Red
    Write-Host "L'outil affichera l'aperçu, fera une sauvegarde de securite, puis demandera une confirmation."
    Invoke-BackupTool -Arguments @("restore", "--project", $projectId, "--file", $backupFile, "--apply")
  } else {
    Write-Host "Apercu uniquement : la base ne sera pas modifiee."
    Invoke-BackupTool -Arguments @("restore", "--project", $projectId, "--file", $backupFile)
  }
}

try {
  if ($env:FIRESTORE_EMULATOR_HOST) {
    throw "FIRESTORE_EMULATOR_HOST est defini sur $($env:FIRESTORE_EMULATOR_HOST). Fermez cette fenetre et relancez le programme hors de l'emulateur pour eviter de viser la mauvaise base."
  }
  if (-not (Get-Command powershell.exe -ErrorAction SilentlyContinue)) {
    throw "Windows PowerShell n'a pas ete trouve."
  }
  if (-not (Test-Path -LiteralPath $scriptFile -PathType Leaf)) {
    throw "Le script firestore-backup.js est introuvable dans le meme dossier."
  }
  if (-not (Test-Path -LiteralPath $dependencyPath -PathType Container)) {
    throw "Les dependances Firebase Admin sont absentes. Depuis la racine du projet, executez : npm --prefix functions install"
  }

  $script:nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $script:nodeCommand) {
    throw "Node.js est introuvable. Installez Node.js puis relancez ce programme."
  }
  $script:scriptFile = $scriptFile

  while ($true) {
    Clear-Host
    Write-Host "SAUVEGARDE / RESTAURATION FIRESTORE - forfait Spark" -ForegroundColor Cyan
    Write-Host "Le projet par defaut est $defaultProjectId; il sera demande et confirme."
    Write-Host ""
    Write-Host "1. Creer une sauvegarde"
    Write-Host "2. Tester une restauration (apercu sans ecriture)"
    Write-Host "3. Restaurer une sauvegarde (operation destructive)"
    Write-Host "4. Quitter"
    Write-Host ""
    $choice = Read-Host "Votre choix"
    try {
      switch ($choice) {
        "1" { Invoke-BackupAction }
        "2" { Invoke-RestoreAction }
        "3" { Invoke-RestoreAction -Apply }
        "4" { return }
        default { Write-Host "Choix invalide." -ForegroundColor Yellow }
      }
    } catch {
      Write-Host ""
      Write-Host $_.Exception.Message -ForegroundColor Red
    }

    Write-Host ""
    Wait-ForUser
  }
} catch {
  Write-Host ""
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
} finally {
  if ($script:credentialsSetByLauncher) {
    Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
  }
}
