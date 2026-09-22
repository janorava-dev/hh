# Household Hero – pravidla

Rodinná aplikace na domácí práce s gamifikací. 4 uživatelé (2 rodiče, 2 děti), každý má vlastní účet.

## Měny

| Měna | K čemu | Vlastnost |
|---|---|---|
| **Minuty** | herní čas na mobilu | vydělají se a spotřebují |
| **XP** | level, forma hrdiny, výbava, žebříček | jen roste, neutrácí se |

## Večerní mise

Do 20:30 musí dítě splnit **všech 5** (všechno, nebo nic):

1. v posteli do 20:30
2. vyčištěné zuby
3. uklizený stůl
4. věci do školy připravené
5. nic dětského mimo dětský pokojík

Odměna: **30 min** hraní a **40 XP**. Rodič misi schvaluje.

## Bonusové úkoly

Navíc za koš, myčku, prádlo apod. Každý má minuty a XP. **Bez denního stropu** minut ani XP: co rodič schválí, to se připíše celé (dítě by strop demotivoval).

## Kdy minuty platí

**Všechny minuty (mise i bonusy) se připisují na následující den.**

## Trhliny štítu

- Za den je max. **3 trhliny** (odmlouvání, odmítnutí pomoci, neposlušnost, hrubé chování…). Trhliny uděluje rodič.
- Po **3. trhlině** je následující den **Den regenerace**: žádné hraní.
- Minuty z Dne regenerace se **nepropadnou**, přesunou se o den dál.
- Trhliny neodečítají minuty z peněženky.

## Hrdinové

Dítě si vybírá z nabídky (Rytíř, Čaroděj, Ninja, Kosmonaut, Robot, Liška, SuperOndatra). XP odemyká:

| Level | Forma | Odemyká |
|---|---|---|
| 1 | Učeň | |
| 2 | | plášť |
| 3 | Bojovník | šála a medaile |
| 5 | | nástroj (koště, sprej, houba) |
| 6 | Šampion | |
| 7 | | parťák |
| 9 | | aura |
| 10 | Legenda | |

Práh XP pro levely 1–10: 0, 100, 500, 1100, 2000, 3100, 4400, 6000, 7900, 10000 (pomalejší křivka: při ~120 XP/den je level 10 asi po 12 týdnech). Prahy jsou na jednom místě, v `src/game.ts` (`XPT`); server je posílá klientovi.

## Otevřené

- Vynucení času na telefonech (Family Link nemá oficiální API) – rozhodnout později.

## Trénink počítání

- Rodič u dítěte vyplní **rok narození**. Z něj se odvodí ročník (školní rok začíná v září: dítě narozené 2018 je od 9/2026 ve 3. třídě) a podle ročníku se generují příklady.
- Sada má **10 příkladů**. Server příklady vygeneruje a drží správné odpovědi, dítě posílá odpovědi po jedné a hned vidí, jestli to sedí.
- Úspěšnost **aspoň 80 %**: **+5 min** (od zítřka) a **+15 XP**. Úspěšnost 50–79 %: jen +5 XP. Pod 50 %: nic.
- **Strop 15 min za den** z tréninku. Po jeho dosažení sady dál dávají XP. Strop XP není.
- Sada odpovězená příliš rychle (méně než 12 s celkem) se nepočítá.
- Obtížnost: 1. třída sčítání do 20, 2. do 100 a malá násobilka, 3. násobilka a dělení, 4. písemné počty a zbytek po dělení, 5. desetinná čísla, zlomky, násobení dvojciferných, 6.+ procenta a záporná čísla. Zadání obsahuje i pár slovních úloh.

## Historie

- Pro každé dítě a den se ukládá souhrn (`daily_stats`): získané XP a minuty, minuty k dispozici, přenesené a zamčené, trhliny, mise, bonusy, trénink, XP celkem a level.
- Souhrn se přepočítává při každé změně, při zobrazení historie a v noci (cron). Zdrojem pravdy zůstávají účetní kniha, trhliny, mise a trénink.
- Rodič vidí historii na stránce Rodič a může ji stáhnout jako CSV (středník, UTF-8 s BOM, otevře se v Excelu). Dítě vidí posledních 14 dní v záložce Družina.

## Hrdinské bludiště (hra)

Hra typu Pac-Man: dítě hraje samo za sebe se svým avatarem, sbírá tečky a utíká před čtyřmi duchy. Velká tečka z duchů udělá kořist. Hra má 3 životy a 3 levely (rostoucí rychlost duchů, druhý level je otevřenější). Tempo (Pomalé 0,8× / Střední / Rychlé 1,25×) a ovládání (tažení prstem / šipky) si volí hráč v menu; základní rychlost hráče je 4,2 dlaždice za sekundu, duchů 3,0. Ovládá se tažením prstu, šipkami pod hrou nebo klávesnicí. Duchové dítě „sežerou“, hra skončí, nebo ji dítě dohraje. **Denní strop času ani skóre není.**

- **Nepočítá se do herního limitu** (minut). Je to bonus, který se odemyká **spuštěními**: jedno spuštění = jedna hra.
- Výchozí pravidlo: **schválená večerní mise = 3 spuštění na další den**. Spuštění se kumulují, dokud je dítě nevyužije, a nepropadají ani v Den regenerace.
- Rodič nastavuje na stránce Rodič: kolik spuštění dítě dostane **denně zdarma** (nekumuluje se), **za večerní misi**, **za sadu příkladů** (aspoň 80 %) a u každého bonusového úkolu políčko **Hra**. Může také dítěti přidat spuštění ručně (+1).
- **V Den regenerace je hra zamčená.**
- **Rodiče hrají bez omezení** počtu spuštění (a vybírají si postavu).
- Skóre se ukládá, dítě vidí svůj rekord a žebříček sourozenců. Skóre, které je za uplynulý čas nemožné, se ořízne.
- Hra běží v aplikaci a vyžaduje přihlášení.

## Napojení na Family Link (přes Home Assistant)

Neoficiální, viz [ha-setup.html](../hh/public/ha-setup.html) pro návod k zapojení. Google nemá pro Family Link veřejné API; napojení jde jen přes komunitní doplněk (např. HAFamilyLink2.0) běžící na vlastním Home Assistant.

- **Household Hero je zdroj pravdy.** Každou noc (stejný cron jako přepočet historie) spočítá pro každé dítě, kolik minut má dnes k dispozici (`usable` ze `childState`) a jestli je Den regenerace, a pošle to na webhook v Home Assistant. Posílá se „nastav na X", ne „přidej X" – nevadí poslat totéž vícekrát.
- Rodič na stránce Rodič zapne přepínač, vyplní webhook URL (a nepovinně token, posílá se jako `Authorization: Bearer`), a u každého dítěte vyplní jeho ID v Home Assistant (typicky `device_id` z HAFamilyLink2.0, např. `switch.jony_phone`).
- Tlačítko **Synchronizovat teď** pošle aktuální stav okamžitě, pro ověření zapojení.
- Poslední pokus (úspěch/chyba, minuty, zamčeno) se ukládá do `ha_sync_log` (posledních 20 na dítě) a zobrazuje se rodiči.
- Bez zapnutí, bez webhooku nebo bez mapování dítěte sync vrátí srozumitelnou chybu a nic neposílá.
