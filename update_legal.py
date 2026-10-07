import re

with open("static/index.html", "r", encoding="utf-8") as f:
    content = f.read()

start_marker = '<div class="flex-1 overflow-y-auto space-y-3 text-xs text-zinc-300 pr-1 leading-relaxed">'
end_marker = '          <button onclick="closeLegalModal()"'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker, start_idx)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + """<div class="flex-1 overflow-y-auto space-y-3 text-xs text-zinc-300 pr-1 leading-relaxed">
            
            <div class="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
              <div class="font-bold text-white text-[11px] uppercase tracking-wider">Éditeur & Hébergement</div>
              <p class="text-[11px] text-zinc-400">
                HOOPS PRONO est une application de divertissement privée à but non lucratif éditée à titre personnel. Hébergement assuré par Render Networks (San Francisco, CA).
              </p>
            </div>

            <div class="space-y-1.5">
              <div class="font-bold text-white text-[11px] uppercase tracking-wider">Données Personnelles (RGPD)</div>
              <p class="text-[11px] text-zinc-400">
                L'application collecte uniquement les données nécessaires à l'authentification et au calcul des classements. Conformément au RGPD, chaque utilisateur dispose d'un droit d'accès, de rectification et de suppression de ses données via les paramètres de son compte. Aucune donnée n'est revendue à des tiers ou utilisée à des fins commerciales.
              </p>
            </div>

            <div class="p-3 rounded-xl bg-white/5 border border-white/10 space-y-1">
              <div class="font-bold text-white text-[11px] uppercase tracking-wider">Indépendance & Non-Affiliation</div>
              <p class="text-[11px] text-zinc-400">
                HOOPS PRONO est une application indépendante de jeu de pronostics gratuits et d'animation communautaire. Elle n'est en aucun cas affiliée, sponsorisée, autorisée ou approuvée par la National Basketball Association (NBA), la NBPA ou leurs filiales.
              </p>
            </div>
            <div class="space-y-1.5">
              <div class="font-bold text-white text-[11px] uppercase tracking-wider">Usage Loyal d'Informations (Nominative Fair Use)</div>
              <p class="text-[11px] text-zinc-400">
                Les noms géographiques de villes, abréviations, statistiques publiques, calendriers et résultats de rencontres sportives sont utilisés uniquement à des fins d'identification factuelle et d'information du public, conformément au principe de l'usage loyal (Nominative Fair Use).
              </p>
              <p class="text-[11px] text-zinc-400">
                Toutes les marques commerciales, dénominations de franchises et logos cités ou référencés demeurent la propriété exclusive de leurs ayants droit respectifs.
              </p>
            </div>
            <div class="space-y-1">
              <div class="font-bold text-white text-[11px] uppercase tracking-wider text-rose-400 flex items-center gap-1">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                Jeu Gratuit sans Argent Réel
              </div>
              <p class="text-[11px] text-zinc-400">
                HOOPS PRONO est un jeu 100% gratuit entre amis. <strong>Aucun pari d'argent réel n'est proposé</strong>, accepté ou facilité sur cette plateforme. Ce site ne rentre pas dans le cadre de la législation sur les jeux d'argent (ANJ) car il n'implique aucune mise financière.
              </p>
            </div>
          </div>
""" + content[end_idx:]
    with open("static/index.html", "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Success")
else:
    print("Markers not found!")
