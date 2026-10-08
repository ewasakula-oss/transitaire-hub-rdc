/* ============================================================
   TRANSITAIRE HUB RDC — V7
   Moteur de recherche robuste
   ============================================================ */

"use strict";

let transitaires = [];
let donneesChargees = false;

const INCONNU = new Set([
    "a verifier",
    "a vérifier",
    "inconnu",
    "non renseigne",
    "non renseigné",
    "n/a",
    "na"
]);

function normaliser(valeur) {
    return String(valeur ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[’']/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function estInconnu(valeur) {
    return INCONNU.has(normaliser(valeur));
}

function versListe(valeur) {
    if (Array.isArray(valeur)) return valeur;
    if (valeur === undefined || valeur === null || valeur === "") return [];
    return [valeur];
}

function contientInconnu(liste) {
    return versListe(liste).some(estInconnu);
}

function simplifierMarchandise(valeur) {
    let texte = normaliser(valeur);

    const synonymes = {
        vetement: "vetements",
        vetements: "vetements",
        chaussure: "chaussures",
        chaussures: "chaussures",
        telephone: "telephones",
        telephones: "telephones",
        smartphone: "telephones",
        smartphones: "telephones",
        portable: "telephones",
        portables: "telephones",
        electronique: "electronique",
        electroniques: "electronique",
        accessoire: "accessoires",
        accessoires: "accessoires"
    };

    return synonymes[texte] || texte;
}

function texteContientRecherche(item, recherche) {
    const cible = simplifierMarchandise(item);
    const requete = simplifierMarchandise(recherche);
    if (!cible || !requete) return false;
    return cible === requete || cible.includes(requete) || requete.includes(cible);
}

function correspondListe(liste, recherche, type) {
    if (!recherche) {
        return {
            match: true,
            parVerification: false,
            correspondanceConfirmee: false
        };
    }

    const valeurs = versListe(liste);
    const inconnue = contientInconnu(valeurs);

    for (const valeur of valeurs) {
        if (estInconnu(valeur)) continue;

        const texte = type === "marchandise"
            ? texteContientRecherche(valeur, recherche)
            : normaliser(valeur) === normaliser(recherche);

        if (texte) {
            return {
                match: true,
                parVerification: false,
                correspondanceConfirmee: true
            };
        }
    }

    /*
     * Une donnée inconnue reste exploitable comme résultat
     * secondaire, mais elle n'est pas considérée comme
     * une correspondance confirmée.
     */
    if (inconnue) {
        return {
            match: true,
            parVerification: true,
            correspondanceConfirmee: false
        };
    }

    /*
     * Une donnée connue mais différente ne correspond pas
     * à la recherche.
     */
    return {
        match: false,
        parVerification: false,
        correspondanceConfirmee: false
    };
}

function poidsMinimum(transitaire) {
    const brut = transitaire?.poids_minimum;

    if (
        brut === null ||
        brut === undefined ||
        String(brut).trim() === ""
    ) {
        return null;
    }

    const valeur = Number(brut);
    return Number.isFinite(valeur) && valeur >= 0 ? valeur : null;
}

function obtenirTrancheTarifaire(transitaire, poids) {
    const kg = Number(poids);

    if (!Number.isFinite(kg) || kg <= 0) {
        return null;
    }

    const tranches =
        Array.isArray(transitaire?.tarification?.tranches)
            ? transitaire.tarification.tranches
            : [];

    for (let i = 0; i < tranches.length; i++) {
        const tranche = tranches[i] || {};

        const minimum = Number(tranche.min_kg);

        const maximum =
            tranche.max_kg === null ||
            tranche.max_kg === undefined ||
            tranche.max_kg === ""
                ? null
                : Number(tranche.max_kg);

        if (!Number.isFinite(minimum)) {
            continue;
        }

        const minimumOK = kg >= minimum;

        const maximumOK =
            i === tranches.length - 1
                ? true
                : Number.isFinite(maximum)
                    ? kg < maximum
                    : true;

        if (minimumOK && maximumOK) {
            return tranche;
        }
    }

    return null;
}

function creerBlocTarification(transitaire, poids) {
    if (!poids) {
        return "";
    }

    const tranche =
        obtenirTrancheTarifaire(
            transitaire,
            poids
        );

    if (!tranche) {
        return `
            <div class="info-line">
                <strong>💰 Tarif applicable :</strong>
                À vérifier
            </div>`;
    }

    const tarification =
        transitaire.tarification || {};

    const devise =
        tarification.devise || "À vérifier";

    const unite =
        tarification.unite_tarifaire || "À vérifier";

    const type =
        tarification.type || "À vérifier";

    const prixBrut = tranche.prix;

    const prixValide =
        prixBrut !== null &&
        prixBrut !== undefined &&
        String(prixBrut).trim() !== "" &&
        Number.isFinite(Number(prixBrut)) &&
        Number(prixBrut) >= 0;

    const prix =
        prixValide
            ? Number(prixBrut)
            : null;

    const uniteConnue =
        unite &&
        !estInconnu(unite);

    const prixAffiche =
        prixValide
            ? `${prix} ${devise}${
                uniteConnue
                    ? "/" + String(unite).replace(/\s+/g, "")
                    : ""
              }`
            : "À vérifier";

    const typeNormalise =
        normaliser(type);

    const uniteNormalisee =
        normaliser(unite);

    const prixAuKg =
        typeNormalise.includes("kg") ||
        uniteNormalisee.includes("kg");

    let estimation = "Non disponible";
    let transportTotal = null;

    if (prixValide && prixAuKg) {
        transportTotal = Number(poids) * prix;

        estimation =
            `${transportTotal.toLocaleString("fr-FR")} ${devise}`;
    }

    const fraisDossierBrut =
        tarification.frais_dossier;

    const fraisDossierValide =
        fraisDossierBrut !== null &&
        fraisDossierBrut !== undefined &&
        String(fraisDossierBrut).trim() !== "" &&
        Number.isFinite(Number(fraisDossierBrut)) &&
        Number(fraisDossierBrut) >= 0;

    const fraisDossier =
        fraisDossierValide
            ? Number(fraisDossierBrut)
            : null;

    const totalEstimatif =
        transportTotal !== null &&
        fraisDossier !== null
            ? transportTotal + fraisDossier
            : transportTotal;

    const statut =
        tranche.statut || "À vérifier";

    const tarifVerifie =
        estInconnu(statut)
            ? "À vérifier"
            : (
                normaliser(statut).includes("verif")
                    ? "À vérifier"
                    : "Oui"
              );

    const sourceTarif =
        tranche.source ||
        tarification.source_tarif ||
        "À vérifier";

    const dateVerification =
        tranche.date_verification ||
        tarification.date_verification ||
        "À vérifier";

    const fraisSupplementaires =
        fraisDossier !== null
            ? "Autres frais éventuels non renseignés."
            : "Frais supplémentaires non renseignés.";

    return `
        <div class="info-line">
            <strong>💰 Tarif applicable :</strong>
            ${echapperHTML(prixAffiche)}
        </div>

        <div class="info-line">
            <strong>📦 Tranche :</strong>
            ${echapperHTML(
                tranche.libelle || "À vérifier"
            )}
        </div>

        <div class="info-line">
            <strong>Transport :</strong>
            ${echapperHTML(estimation)}
        </div>

        <div class="info-line">
            <strong>📄 Frais de dossier :</strong>
            ${
                fraisDossier !== null
                    ? echapperHTML(
                        `${fraisDossier.toLocaleString("fr-FR")} ${devise}`
                      )
                    : "À vérifier"
            }
        </div>

        <div class="info-line">
            <strong>💵 Total estimatif :</strong>
            ${
                totalEstimatif !== null
                    ? echapperHTML(
                        `${totalEstimatif.toLocaleString("fr-FR")} ${devise}`
                      )
                    : "Non disponible"
            }
        </div>

        <div class="info-line">
            <strong>🔎 Source tarifaire :</strong>
            ${echapperHTML(sourceTarif)}
        </div>

        <div class="info-line">
            <strong>📅 Vérifié le :</strong>
            ${echapperHTML(dateVerification)}
        </div>

        <div class="info-line">
            <strong>⚠️ Frais supplémentaires :</strong>
            ${echapperHTML(fraisSupplementaires)}
        </div>

        <div class="info-line">
            <strong>✅ Tarif vérifié :</strong>
            ${echapperHTML(tarifVerifie)}
        </div>`;
}

async function chargerTransitaires() {
    const etat = document.getElementById("etat-chargement");

    try {
        etat.textContent = "Chargement de la base…";
        etat.className = "status";

        const reponse = await fetch("data/transitaires.json", {
            cache: "no-store"
        });

        if (!reponse.ok) {
            throw new Error("HTTP " + reponse.status);
        }

        const json = await reponse.json();

        if (!Array.isArray(json)) {
            throw new Error("La base JSON doit contenir un tableau.");
        }

        transitaires = json;
        donneesChargees = true;

        remplirFiltres();

        etat.textContent =
            transitaires.length + " transitaire(s) chargé(s).";

        etat.className = "status ok";

    } catch (erreur) {
        donneesChargees = false;

        etat.textContent =
            "La base n'a pas pu être chargée.";

        etat.className = "status fail";

        afficherErreurChargement(erreur);

        console.error(
            "TRANSITAIRE HUB RDC — erreur de chargement :",
            erreur
        );
    }
}

function afficherErreurChargement(erreur) {
    const cards = document.getElementById("cards");

    if (!cards) return;

    const detail = location.protocol === "file:"
        ? "La page est ouverte directement comme fichier. Lance le serveur local Python puis ouvre l'adresse http://127.0.0.1:8000."
        : "Vérifie que data/transitaires.json existe et que le serveur local fonctionne.";

    cards.innerHTML = `
        <div class="error-box">
            <div class="icon">⚠️</div>
            <h3>Base indisponible</h3>
            <p>
                <strong>
                    ${echapperHTML(
                        String(erreur.message || erreur)
                    )}
                </strong>
            </p>
            <p style="margin-top:8px">
                ${echapperHTML(detail)}
            </p>
        </div>`;
}

function villesChine(transitaire) {
    const poles = versListe(transitaire.poles_chine);

    if (
        poles.length &&
        !poles.every(v => estInconnu(v))
    ) {
        return poles;
    }

    return versListe(transitaire.villes_chine);
}

function remplirFiltres() {
    remplirSelect(
        "depart",
        transitaires.flatMap(
            t => villesChine(t)
        )
    );

    remplirSelect(
        "destination",
        transitaires.flatMap(
            t => versListe(t.destinations_rdc)
        )
    );
}

function remplirSelect(id, valeurs) {
    const select = document.getElementById(id);
    const actuelle = select.value;

    const uniques = [...new Set(
        valeurs
            .map(v => String(v || "").trim())
            .filter(v => v && !estInconnu(v))
            .sort(
                (a, b) =>
                    normaliser(a).localeCompare(
                        normaliser(b)
                    )
            )
    )];

    const libelle =
        id === "depart"
            ? "Toutes les origines"
            : "Toutes les destinations";

    select.innerHTML =
        `<option value="">${libelle}</option>`;

    uniques.forEach(v => {
        const option = document.createElement("option");

        option.value = v;
        option.textContent = v;

        select.appendChild(option);
    });

    if (uniques.includes(actuelle)) {
        select.value = actuelle;
    }
}

async function rechercher() {
    if (!donneesChargees) {
        afficherErreurChargement(
            new Error(
                "La base des transitaires n'est pas chargée."
            )
        );

        return;
    }

    const depart =
        document.getElementById("depart").value.trim();

    const destination =
        document.getElementById("destination").value.trim();

    const marchandise =
        document.getElementById("marchandise").value.trim();

    const poids =
        Number(
            document.getElementById("poids").value
        ) || 0;

    if (
        !depart &&
        !destination &&
        !marchandise &&
        !poids
    ) {
        afficherResultats(
            transitaires,
            {
                depart,
                destination,
                marchandise,
                poids,
                rechercheLibre: true
            }
        );

        return;
    }

    const candidats = transitaires
        .map(transitaire => {

            const departResult =
                depart
                    ? {
                        match: villesChine(transitaire)
                            .some(
                                v =>
                                    !estInconnu(v) &&
                                    normaliser(v) === normaliser(depart)
                            ),
                        parVerification: false,
                        correspondanceConfirmee: true
                    }
                    : {
                        match: true,
                        parVerification: false,
                        correspondanceConfirmee: false
                    };

            const destinationResult =
                correspondListe(
                    transitaire.destinations_rdc,
                    destination,
                    "ville"
                );

            const marchandiseResult =
                correspondListe(
                    transitaire.marchandises,
                    marchandise,
                    "marchandise"
                );

            const minimum =
                poidsMinimum(transitaire);

            const poidsOK =
                !poids ||
                poids >= minimum ||
                minimum === 0;

            const correspond =
                departResult.match &&
                destinationResult.match &&
                marchandiseResult.match &&
                poidsOK;

            const inconnues = [
                departResult.parVerification,
                destinationResult.parVerification,
                marchandiseResult.parVerification,
                Boolean(
                    poids && minimum === 0
                )
            ].filter(Boolean).length;

            const confirmees = [
                depart
                    ? !departResult.parVerification
                    : false,

                destination
                    ? !destinationResult.parVerification
                    : false,

                marchandise
                    ? !marchandiseResult.parVerification
                    : false,

                poids
                    ? minimum > 0 &&
                      poids >= minimum
                    : false
            ].filter(Boolean).length;

            return {
                transitaire,
                correspond,
                inconnues,
                confirmees
            };
        })
        .filter(x => x.correspond)
        .sort((a, b) => {

            if (a.inconnues !== b.inconnues) {
                return a.inconnues - b.inconnues;
            }

            return b.confirmees - a.confirmees;
        });

    afficherResultats(
        candidats.map(x => ({
            ...x.transitaire,
            _inconnues: x.inconnues,
            _confirmees: x.confirmees
        })),
        {
            depart,
            destination,
            marchandise,
            poids,
            rechercheLibre: false
        }
    );
}

function afficherResultats(resultats, recherche) {
    document.getElementById(
        "section-recherche"
    ).style.display = "none";

    document.getElementById(
        "section-resultats"
    ).style.display = "block";

    document.getElementById(
        "bouton-reset"
    ).style.display = "block";

    const description = [];

    if (recherche.depart) {
        description.push(
            `🇨🇳 ${recherche.depart}`
        );
    }

    if (recherche.destination) {
        description.push(
            `📍 ${recherche.destination}`
        );
    }

    if (recherche.marchandise) {
        description.push(
            `📦 ${recherche.marchandise}`
        );
    }

    if (recherche.poids) {
        description.push(
            `⚖️ ${recherche.poids} kg`
        );
    }

    document.getElementById("summary").innerHTML =
        recherche.rechercheLibre
            ? `Base actuelle : <strong>${resultats.length}</strong> transitaire(s).`
            : `${description.join(" → ")}<br><strong>${resultats.length}</strong> résultat(s) trouvé(s).`;

    const cards =
        document.getElementById("cards");

    if (!resultats.length) {
        cards.innerHTML = `
            <div class="no-results">
                <div class="icon">🔎</div>
                <h3>Aucun résultat trouvé</h3>
                <p>
                    Essaie une autre origine,
                    destination ou désignation de marchandise.
                    Une information « À vérifier »
                    n'exclut pas automatiquement un opérateur.
                </p>
            </div>`;

        return;
    }

    cards.innerHTML =
        resultats
            .map(t => creerCarte(t, recherche))
            .join("");
}

function creerCarte(t, recherche = {}) {
    const whatsapp =
        nettoyerTelephone(
            t.whatsapp || t.telephone
        );

    const telephone =
        String(t.telephone || "").trim();

    const statusVerification =
        t._inconnues > 0
            ? "Informations à vérifier"
            : "Correspondance confirmée";

    const badgeClass =
        t._inconnues > 0
            ? "badge warning"
            : "badge";

    const services =
        versListe(
            t.services || t.transport
        )
        .filter(Boolean)
        .map(
            x =>
                `<span class="tag">${echapperHTML(x)}</span>`
        )
        .join("");

    const transport =
        versListe(t.transport)
        .filter(Boolean)
        .map(
            x =>
                `<span class="tag">${echapperHTML(x)}</span>`
        )
        .join("");

    const destinations =
        versListe(t.destinations_rdc).join(", ")
        || "À vérifier";

    const chine =
        villesChine(t).join(" / ")
        || "À vérifier";

    const marchandises =
        versListe(t.marchandises).join(", ")
        || "À vérifier";

    const source =
        t.source ||
        (
            Array.isArray(t.sources) &&
            t.sources[0]?.nom
        ) ||
        "À vérifier";

    const date =
        t.date_verification ||
        "À vérifier";

    const blocTarification =
        creerBlocTarification(
            t,
            recherche?.poids || 0
        );

    return `
        <article class="card">

            <div class="card-top">
                <div class="company">
                    ${echapperHTML(
                        t.nom ||
                        "Transitaire sans nom"
                    )}
                </div>

                <div class="${badgeClass}">
                    ${statusVerification}
                </div>
            </div>

            <div class="location">
                📍 ${echapperHTML(
                    t.ville ||
                    "Ville à vérifier"
                )}
            </div>

            <div class="tags">
                ${services || transport || ""}
            </div>

            <div class="info-line">
                <strong>🇨🇳 Chine :</strong>
                ${echapperHTML(chine)}
            </div>

            <div class="info-line">
                <strong>📍 RDC :</strong>
                ${echapperHTML(destinations)}
            </div>

            <div class="info-line">
                <strong>📦 Marchandises :</strong>
                ${echapperHTML(marchandises)}
            </div>

            <div class="info-line">
                <strong>⚖️ Poids minimum :</strong>
                ${poidsMinimum(t) === null
                    ? "À vérifier"
                    : `${echapperHTML(String(poidsMinimum(t)))} kg`
                }
            </div>

            ${blocTarification}

            <div class="buttons">

                <button
                    class="btn btn-details"
                    type="button"
                    data-action="details"
                    data-id="${echapperHTML(String(t.id))}"
                >
                    Voir la fiche
                </button>

                ${
                    whatsapp
                    ? `<a
                        class="btn btn-whatsapp"
                        href="https://wa.me/${whatsapp}"
                        target="_blank"
                        rel="noopener"
                    >WhatsApp</a>`
                    : `<span class="btn btn-whatsapp">
                        WhatsApp non disponible
                    </span>`
                }

                ${
                    telephone
                    ? `<a
                        class="btn btn-call"
                        href="tel:${echapperHTML(telephone)}"
                    >📞 Appeler</a>`
                    : `<span class="btn btn-call">
                        Téléphone non disponible
                    </span>`
                }

            </div>

            <div
                id="details-${echapperHTML(String(t.id))}"
                class="details"
            >
                <strong>Fiche du transitaire</strong><br>

                📍 Adresse :
                ${echapperHTML(
                    t.adresse || "À vérifier"
                )}<br>

                📞 Téléphone :
                ${echapperHTML(
                    telephone || "À vérifier"
                )}<br>

                💬 WhatsApp :
                ${echapperHTML(
                    t.whatsapp || "À vérifier"
                )}<br>

                🇨🇳 Chine :
                ${echapperHTML(chine)}<br>

                📍 Destinations RDC :
                ${echapperHTML(destinations)}<br>

                📦 Marchandises :
                ${echapperHTML(marchandises)}<br>

                🚚 Transport :
                ${echapperHTML(
                    versListe(t.transport)
                        .join(", ") ||
                    "À vérifier"
                )}<br>

                🧾 Tarifs :
                ${echapperHTML(
                    t.tarifs || "À vérifier"
                )}<br>

                ⏱️ Délais :
                ${echapperHTML(
                    t.delais || "À vérifier"
                )}<br>

                🔎 Source :
                ${echapperHTML(source)}<br>

                📅 Vérification :
                ${echapperHTML(date)}<br>

                ⚠️ Statut :
                ${echapperHTML(
                    t.statut_verification ||
                    "À vérifier"
                )}
            </div>

        </article>`;
}

function nettoyerTelephone(valeur) {
    return String(valeur || "")
        .replace(/[^0-9]/g, "");
}

function echapperHTML(valeur) {
    return String(valeur ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function retourRecherche() {
    document.getElementById(
        "section-recherche"
    ).style.display = "block";

    document.getElementById(
        "section-resultats"
    ).style.display = "none";

    window.scrollTo(0, 0);
}

function reinitialiser() {
    document.getElementById(
        "depart"
    ).value = "";

    document.getElementById(
        "destination"
    ).value = "";

    document.getElementById(
        "marchandise"
    ).value = "";

    document.getElementById(
        "poids"
    ).value = "";

    retourRecherche();
}

document.addEventListener(
    "click",
    event => {

        const bouton =
            event.target.closest(
                '[data-action="details"]'
            );

        if (!bouton) return;

        const bloc =
            document.getElementById(
                "details-" +
                bouton.dataset.id
            );

        if (!bloc) return;

        const ouvert =
            bloc.style.display === "block";

        bloc.style.display =
            ouvert ? "none" : "block";

        bouton.textContent =
            ouvert
                ? "Voir la fiche"
                : "Masquer la fiche";
    }
);

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        document
            .getElementById("bouton-recherche")
            .addEventListener(
                "click",
                rechercher
            );

        document
            .getElementById("bouton-retour")
            .addEventListener(
                "click",
                retourRecherche
            );

        document
            .getElementById("bouton-reset")
            .addEventListener(
                "click",
                reinitialiser
            );

        document
            .getElementById("marchandise")
            .addEventListener(
                "keydown",
                event => {
                    if (event.key === "Enter") {
                        rechercher();
                    }
                }
            );

        document
            .getElementById("poids")
            .addEventListener(
                "keydown",
                event => {
                    if (event.key === "Enter") {
                        rechercher();
                    }
                }
            );

        await chargerTransitaires();
    }
);
