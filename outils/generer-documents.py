"""
Génère les documents Word du projet à partir de leurs sources Markdown.

Pandoc reprend les styles, polices, marges et pied de page du document de référence via
--reference-doc, mais IGNORE son corps : la page de garde n'est donc pas reprise. Ce script la
reconstruit en clonant le bloc XML de couverture du document de référence et en y substituant les
valeurs du projet, puis insère le sommaire (champ TOC) juste après.

La couverture de référence ne contient ni image ni relation externe (vérifié à chaque exécution) :
une substitution de texte suffit, sans avoir à recopier de médias ni à réécrire les relations.

Usage :
    python outils/generer-documents.py                      # tous les documents
    python outils/generer-documents.py GUIDE_UTILISATION.md # un seul
"""

import html
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
REFERENCE_DOCX = Path(r"D:\Informatique\Java\permanence\ANALYSE_ET_CONCEPTION.docx")

PROJET = "Sentinel"

# Page de garde, par document : texte présent dans le document de référence -> texte du projet.
#
# L'ordre compte, les substitutions étant appliquées EN SÉQUENCE sur le texte de chaque
# paragraphe : les chaînes les plus longues d'abord, pour qu'une substitution partielle ne rende
# pas la suivante inopérante. En particulier, la valeur « Document associé » du modèle
# (« Spécification technique — Permanence et Astreinte ») doit être traitée AVANT la règle
# générique sur le nom du projet, sinon elle ne correspondrait plus.
#
# La barre est un tiret cadratin U+2014, pas un trait d'union : vérifié dans le XML du modèle.
SOUS_TITRE_MODELE = "Analyse fonctionnelle, modèle de données et choix de conception"
DOCUMENT_ASSOCIE_MODELE = "Spécification technique — Permanence et Astreinte"

DOCUMENTS = {
    "ANALYSE_ET_CONCEPTION.md": [
        (SOUS_TITRE_MODELE, "Architecture, modèle de données et choix de conception"),
        (DOCUMENT_ASSOCIE_MODELE, "Architecture serveurs et applications monétiques"),
        ("Août 2026", "Septembre 2026"),
        ("Permanence et Astreinte", PROJET),
    ],
    "GUIDE_DEPLOIEMENT.md": [
        (SOUS_TITRE_MODELE, "Installation, configuration et exploitation"),
        ("Document d'analyse et de conception", "Guide de déploiement"),
        (DOCUMENT_ASSOCIE_MODELE, "Document d'analyse et de conception"),
        ("Août 2026", "Septembre 2026"),
        ("Permanence et Astreinte", PROJET),
    ],
    "GUIDE_UTILISATION.md": [
        (SOUS_TITRE_MODELE, "Prise en main de l'application, par profil d'utilisateur"),
        ("Document d'analyse et de conception", "Guide d'utilisation"),
        (DOCUMENT_ASSOCIE_MODELE, "Document d'analyse et de conception"),
        ("Août 2026", "Septembre 2026"),
        ("Permanence et Astreinte", PROJET),
    ],
}

# Un <w:t> et RIEN d'autre : sans le \s, le motif attraperait aussi <w:tbl>, <w:tc>, <w:tr>…
# (le « bl » de <w:tbl> satisfaisant un [^>]* trop permissif), et le contenu de tableaux entiers
# se retrouverait échappé en texte littéral.
MOTIF_TEXTE = re.compile(r"(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)", re.S)
MOTIF_PARAGRAPHE = re.compile(r"<w:p\b.*?</w:p>", re.S)

MOTIF_RACINE = re.compile(r"<w:document\b[^>]*>")
MOTIF_ATTRIBUT_PREFIXE = re.compile(r'\s([A-Za-z0-9]+):([\w-]+)="[^"]*"')
MOTIF_ELEMENT_PREFIXE = re.compile(r"</?([A-Za-z0-9]+):")
# « xml: » est lié implicitement par la spécification XML, il n'a pas à être déclaré.
PREFIXES_IMPLICITES = {"xml"}

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# Sommaire : titre au style Titre1 puis champ TOC (niveaux 1 à 3), suivi d'un saut de page.
SOMMAIRE_XML = (
    '<w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>Sommaire</w:t></w:r></w:p>'
    '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
    '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    '<w:r><w:t>Ouvrez le sommaire et appuyez sur F9 pour le mettre à jour.</w:t></w:r>'
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
)


def prefixes_declares(document: str) -> set[str]:
    racine = MOTIF_RACINE.search(document)
    if racine is None:
        raise SystemExit("Racine <w:document> introuvable dans le document généré.")
    return set(re.findall(r"xmlns:([A-Za-z0-9]+)=", racine.group(0))) | PREFIXES_IMPLICITES


def adapter_aux_namespaces(couverture: str, declares: set[str]) -> str:
    """Retire du bloc cloné les attributs dont le préfixe n'est pas déclaré par le document cible.

    Word enrichit ses documents d'attributs propriétaires (w14:paraId, w14:textId… : identifiants
    de paragraphe servant à la co-édition). Pandoc ne déclare pas ces namespaces dans sa racine :
    conservés tels quels, ils produisent un préfixe non lié, donc un XML invalide que Word refuse
    d'ouvrir — sans que pandoc, plus permissif, ne s'en aperçoive.

    Ces attributs ne portent aucune information de mise en forme : les supprimer est sans effet
    sur le rendu. Un ÉLÉMENT à préfixe inconnu serait en revanche une vraie perte de contenu, d'où
    l'échec explicite dans ce cas.
    """
    inconnus = {p for p in MOTIF_ELEMENT_PREFIXE.findall(couverture)} - declares
    if inconnus:
        raise SystemExit(
            f"La couverture utilise des éléments de namespace non déclaré : {sorted(inconnus)}. "
            "Il faudrait déclarer ces namespaces plutôt que de supprimer les éléments."
        )

    def filtrer(match: re.Match) -> str:
        return "" if match.group(1) not in declares else match.group(0)

    return MOTIF_ATTRIBUT_PREFIXE.sub(filtrer, couverture)


def extraire_couverture(reference: Path) -> str:
    """Bloc XML allant du début du corps jusqu'au premier titre de niveau 1 (« Sommaire »)."""
    with zipfile.ZipFile(reference) as z:
        document = z.read("word/document.xml").decode("utf-8")

    debut = document.index("<w:body>") + len("<w:body>")
    premier_titre = document.index('<w:pStyle w:val="Titre1"/>')
    fin = document.rindex("<w:p ", debut, premier_titre)
    couverture = document[debut:fin]

    if "<w:drawing>" in couverture or "r:embed=" in couverture or "r:id=" in couverture:
        raise SystemExit(
            "La couverture de référence contient désormais une image ou une relation : "
            "le clonage par simple substitution de texte n'est plus valable."
        )
    return couverture


def substituer(couverture: str, substitutions: list[tuple[str, str]]) -> tuple[str, set[str]]:
    """Remplace les valeurs du document de référence par celles du projet.

    Word éclate volontiers une phrase en plusieurs « runs » (correcteur orthographique, révisions) :
    une substitution appliquée run par run manquerait donc toute expression de plus d'un mot. Le
    texte est par conséquent recomposé au niveau du PARAGRAPHE, substitué, puis réinjecté dans le
    premier <w:t>, les suivants étant vidés.

    Conséquence assumée : un paragraphe dont les runs portent des mises en forme différentes
    perdrait cette variation. Les paragraphes de la couverture sont uniformes, la question ne se
    pose pas ici — et un paragraphe non modifié est renvoyé tel quel.

    Renvoie aussi l'ensemble des motifs effectivement appliqués : une substitution qui ne
    correspond à rien signale un modèle qui a changé, et se solderait sinon par une page de garde
    silencieusement fausse.
    """
    appliquees: set[str] = set()

    def traiter_paragraphe(match: re.Match) -> str:
        paragraphe = match.group(0)
        morceaux = list(MOTIF_TEXTE.finditer(paragraphe))
        if not morceaux:
            return paragraphe

        complet = "".join(html.unescape(m.group(2)) for m in morceaux)
        substitue = complet
        for avant, apres in substitutions:
            if avant in substitue:
                appliquees.add(avant)
                substitue = substitue.replace(avant, apres)
        if substitue == complet:
            return paragraphe

        reconstruit, position = [], 0
        for index, morceau in enumerate(morceaux):
            reconstruit.append(paragraphe[position:morceau.start()])
            ouvrant = morceau.group(1)
            if index == 0:
                # xml:space="preserve" : sans lui, Word rognerait les espaces de bord.
                if "xml:space" not in ouvrant:
                    ouvrant = ouvrant[:-1] + ' xml:space="preserve">'
                reconstruit.append(ouvrant + html.escape(substitue, quote=False) + morceau.group(3))
            else:
                reconstruit.append(ouvrant + morceau.group(3))
            position = morceau.end()
        reconstruit.append(paragraphe[position:])
        return "".join(reconstruit)

    return MOTIF_PARAGRAPHE.sub(traiter_paragraphe, couverture), appliquees


def injecter(docx: Path, couverture: str) -> None:
    """Insère la couverture puis le sommaire en tête du corps du document généré."""
    temporaire = docx.with_suffix(".tmp.docx")

    with zipfile.ZipFile(docx) as source, zipfile.ZipFile(
        temporaire, "w", zipfile.ZIP_DEFLATED
    ) as cible:
        for element in source.infolist():
            contenu = source.read(element.filename)

            if element.filename == "word/document.xml":
                texte = contenu.decode("utf-8")
                bloc = adapter_aux_namespaces(couverture, prefixes_declares(texte))
                position = texte.index("<w:body>") + len("<w:body>")
                texte = texte[:position] + bloc + SOMMAIRE_XML + texte[position:]

                # Word refuse d'ouvrir un document au XML invalide, là où pandoc le relit sans
                # broncher : on valide donc AVANT d'écrire, plutôt que de le découvrir à l'ouverture.
                try:
                    ET.fromstring(texte)
                except ET.ParseError as erreur:
                    raise SystemExit(f"XML produit invalide : {erreur}") from erreur

                contenu = texte.encode("utf-8")

            elif element.filename == "word/settings.xml":
                # Demande à Word de recalculer les champs à l'ouverture, sans quoi le sommaire
                # resterait vide jusqu'à une mise à jour manuelle.
                texte = contenu.decode("utf-8")
                if "updateFields" not in texte:
                    fin_balise = texte.index(">", texte.index("<w:settings")) + 1
                    texte = (texte[:fin_balise]
                             + '<w:updateFields w:val="true"/>'
                             + texte[fin_balise:])
                contenu = texte.encode("utf-8")

            cible.writestr(element, contenu)

    shutil.move(str(temporaire), str(docx))


def generer(nom_markdown: str, substitutions: list[tuple[str, str]], couverture_brute: str) -> None:
    source = RACINE / nom_markdown
    if not source.is_file():
        raise SystemExit(f"Source introuvable : {source}")
    sortie = source.with_suffix(".docx")

    subprocess.run(
        ["pandoc", source.name, "-o", sortie.name,
         f"--reference-doc={REFERENCE_DOCX}", "--resource-path=."],
        cwd=RACINE, check=True,
    )

    couverture, appliquees = substituer(couverture_brute, substitutions)
    manquantes = [avant for avant, _ in substitutions if avant not in appliquees]
    if manquantes:
        raise SystemExit(
            f"{nom_markdown} : ces valeurs sont absentes de la page de garde du modèle et n'ont "
            f"donc pas été remplacées : {manquantes}. Le modèle a probablement changé — la page "
            "de garde produite serait fausse."
        )

    injecter(sortie, couverture)
    print(f"Généré : {sortie}")


def main() -> None:
    if not REFERENCE_DOCX.is_file():
        raise SystemExit(f"Document de référence introuvable : {REFERENCE_DOCX}")

    demandes = sys.argv[1:] or list(DOCUMENTS)
    inconnus = [d for d in demandes if d not in DOCUMENTS]
    if inconnus:
        raise SystemExit(
            f"Document(s) non configuré(s) : {inconnus}. Attendu parmi : {list(DOCUMENTS)}"
        )

    couverture_brute = extraire_couverture(REFERENCE_DOCX)
    for nom in demandes:
        generer(nom, DOCUMENTS[nom], couverture_brute)


if __name__ == "__main__":
    sys.exit(main())
