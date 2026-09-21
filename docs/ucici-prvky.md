# Učící prvky za extra minuty – průzkum a návrh

Stav: 21. 9. 2026. Cíl: děti dostávají extra minuty za trénování (počítání, angličtina…), ideálně napojením na něco existujícího.

## Co existuje a jde napojit

| Služba | Oficiální API | Závěr |
|---|---|---|
| **Duolingo** | Ne. Existují neoficiální knihovny na GitHubu, ale [podmínky](https://www.duolingo.com/terms) zakazují scraping a sbírání dat. | Nenapojovat (křehké, proti podmínkám, vyžaduje přihlašovací údaje dítěte). |
| **Khan Academy** | Ne. Veřejné API ukončili v roce 2020, videa už nejsou otevřeně licencovaná. | Nelze. |
| **Quizlet** | Ne. Podle nezávislého přehledu k 18. 8. 2026 nemá veřejné API pro vývojáře. | Nelze. |
| **Umíme to** (umimeto.org, česká škola hrou) | V dostupné dokumentaci jsem žádné API ani export výsledků nenašel. Rodič má administrátorský účet, zadává úkoly a vidí statistiky. | Přímé napojení nevím. Jde napsat jejich podpoře, ale počítat s ním nelze. |
| **Anki** | AnkiConnect běží jen lokálně v desktopové aplikaci, AnkiWeb API nemá. | Pro tuhle aplikaci nepoužitelné. |
| **H5P** (otevřené interaktivní cvičení) | Ano, přehrávač [h5p-standalone](https://github.com/tunapanda/h5p-standalone) jde vložit na vlastní stránku a posílá xAPI události se skóre. | Použitelné, ale skóre vzniká v prohlížeči dítěte, takže se dá zfalšovat. Vhodné jen pro hodnocení, které schvaluje rodič. |

**Závěr průzkumu:** hotová vzdělávací platforma, na kterou by šlo bezpečně a oficiálně navázat a číst z ní výsledky dětí, neexistuje. Realistické jsou dvě cesty: vlastní cvičení s ověřením na serveru a externí aktivity ověřované rodičem.

## Stavební kameny, které jsou zdarma

- **Rozvrhování opakování slovíček:** [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), open source, běží v prohlížeči i v Workeru.
- **Věty a překlady:** [Tatoeba](https://tatoeba.org/en/downloads), věty ke stažení s páry čeština–angličtina (kolem 17 tisíc překladových jednotek), licence CC BY 2.0 FR, vyžaduje uvedení zdroje.
- **Výslovnost angličtiny:** Web Speech API (`speechSynthesis`) je v Chrome, Safari i na mobilech, hlasy jsou ale ze zařízení a kvalita se liší. Cloudflare Workers AI umí TTS jen pro angličtinu, francouzštinu a španělštinu, ne pro češtinu.

## Návrh: dvě cesty

### A) Vlastní trénink s ověřením na serveru (doporučeno)

Server vygeneruje příklady a drží správné odpovědi. Dítě posílá jen odpovědi a server je vyhodnotí. Minuty se připíšou automaticky, bez schvalování rodičem.

1. **Počítání:** sčítání a odčítání, malá násobilka, dělení se zbytkem, zlomky, podle úrovně (ročníku) dítěte.
2. **Angličtina:** slovíčka čeština ⇄ angličtina, rodič vloží vlastní seznam (např. ze školního sešitu) nebo použije startovní sadu. Opakování řídí FSRS, výslovnost si dítě pustí tlačítkem.
3. Později: pravopis i/y, čtení s porozuměním, hodiny.

**Odměna (návrh):**
- Sada 10 příkladů, úspěšnost aspoň 80 %: 5 min + 15 XP.
- Zvláštní denní strop z tréninku, např. 15 min, samostatný od bonusového stropu 30 min.
- Dál platí pravidlo „minuty od zítřka“.
- Rodič nastavuje úroveň, strop a zapnutí pro každé dítě.

**Ochrana proti podvádění:** jednorázové sady s podpisem, minimální čas na příklad, limit sad za den, po překročení jen XP, přehled výsledků pro rodiče.

### B) Externí aplikace ověřené rodičem (funguje už dnes)

Bonusové úkoly s minutami už existují. Rodič může přidat např. „Duolingo lekce“, „Umíme to 15 minut“, „Čtení 20 minut“. Dítě odešle, rodič schválí podle přehledu v dané aplikaci. Bez programování, jen sdílí bonusový strop 30 min/den.

## Navržené kroky

1. Jednorázově: rodič si přidá učicí bonusové úkoly (cesta B).
2. Matematický trénink (server generuje a ověřuje, denní strop, přehled pro rodiče).
3. Slovíčka s FSRS, vlastní seznamy a výslovnost.
4. Podle zájmu: pravopis i/y, hodiny, sady z H5P schvalované rodičem.

## Otevřené

- Věk / ročník obou dětí (úrovně obtížnosti).
- Kolik minut denně nejvýš za učení.
- Který předmět jako první.
