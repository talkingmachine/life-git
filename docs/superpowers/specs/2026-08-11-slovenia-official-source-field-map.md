# Slovenia Official Source Field Map

## Purpose

This is the recorded field map for the approved Slovenia source-shape repair. It is implementation evidence, not a cache of accepted facts. Production must re-fetch and revalidate the official responses on every new run; it must not pin the observed hashes, current NPB IDs, salary period, or salary value below.

The map was captured on `2026-08-11` directly from the official HTTPS endpoints with Node `fetch`. No browser, client-side script execution, model normalization, cached response, or third-party mirror was used. SHA-256 values cover the exact response bytes observed in that audit and let a reviewer trace every compact fixture field back to one recorded official response.

## Captured Response Provenance

| Role | Method and exact official URL | Status / media type | Bytes | Response SHA-256 |
| --- | --- | --- | ---: | --- |
| `gov-route-page` | GET `https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/` | 200 / `text/html; charset=utf-8` | 25,036 | `57a166b3637d5c2351eb32fe79b30f7dc18f3e1c73953af1d09ee70047dd1985` |
| `ztuj2-registry` | GET `https://pisrs.si/api/rezultat/zbirka/id/ZAKO5761` | 200 / `application/json` | 10,040 | `e7a7f1dcfe91624e1383a5ded3403b4a1ef630e125d05bce9d158b0b89f5dfdb` |
| `ztuj2-details` | GET `https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/298532110/details` | 200 / `application/json` | 1,033,653 | `e4f8b71aaaa02dad8fc2833fe78aa465a005ad54ba593109cd2b367d5beeaf26` |
| `salary-registry` | GET `https://pisrs.si/api/rezultat/zbirka/sop/2026-01-1950` | 200 / `application/json` | 2,048 | `a17f7e97aaa00583ec732bc231667fc3315842617421da677501c08c32bc95b6` |
| `salary-details` | GET `https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/613486752/details` | 200 / `application/json` | 2,741 | `6e42c781690646b3a30475c965b7ae8c4fe823243823475e9a47668cb3011651` |
| `sistat-metadata` | GET `https://pxweb.stat.si/SiStatData/api/v1/en/Data/H285S.px` | 200 / `application/json; charset=utf-8` | 5,252 | `6ca031a46b4f171b87983c752396fb8642e0736acda79ee3a586de93016d9ca0` |
| `sistat-series` | POST the same exact SiStat URL | 200 / `application/json; charset=utf-8` | 16,433 | `7118fba1fdb78e0722efb134083f00f01f2e829c82158b516612e88b365b263f` |
| `ess-companion-page` | GET `https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/` | 200 / `text/html; charset=utf-8` | 52,813 | `a71d5d64369421a1b4b9cd3d7a6037d09b493ba4e835c550a3171900455c057b` |
| `zzsdt-registry` | GET `https://pisrs.si/api/rezultat/zbirka/id/ZAKO6655` | 200 / `application/json` | 5,647 | `10544a5f750982789e31ccc27de536d1021a5da760984df661da8cd15169f081` |
| `zzsdt-details` | GET `https://pisrs.si/api/rezultat/neuradno-precisceno-besedilo/270729002/details` | 200 / `application/json` | 307,169 | `a9e61386a1bb8d6fc3ab13d78dd2fa4495fc8bd7ab48c5e9c63b4c12611ba98c` |

The canonical SiStat POST body was encoded as compact UTF-8 JSON from every metadata dimension, in metadata order:

```json
{"query":[{"code":"MESEC","selection":{"filter":"all","values":["*"]}},{"code":"PLAČE","selection":{"filter":"all","values":["*"]}}],"response":{"format":"json-stat2"}}
```

Its observed request-body SHA-256 was `c51587d0d30a096233aa690537714199d86670e355cbbabf58d5c1b45b2e5121`.

## Shared PISRS Registry Shape

All three registry responses have `error: null`. Required data paths are:

```text
$.data.evidencniPodatki.semafor.{id,naziv}
$.data.evidencniPodatki.{naslov,zunanjiID,sop,objavljeno}
$.data.besedilo.npbVerzije[].{id,naziv}
```

Observed identities:

| Record | Status | Observed version set | Selected current entry |
| --- | --- | --- | --- |
| `ZAKO5761`, `Zakon o tujcih (ZTuj-2)`, SOP `2011-01-2360` | `{id:156,naziv:"Veljaven predpis"}` | 21 unique entries: `Osnovni`, `NPB 1` … `NPB 20` | `{id:298532110,naziv:"NPB 20"}` |
| `ZAKO6655`, `Zakon o zaposlovanju, samozaposlovanju in delu tujcev (ZZSDT)`, SOP `2015-01-1930`, `objavljeno:"2015-06-30"` | `{id:156,naziv:"Veljaven predpis"}` | 9 unique entries: `Osnovni`, `NPB 1` … `NPB 8` | `{id:270729002,naziv:"NPB 8"}` |
| SOP `2026-01-1950`, `zunanjiID:"SKLE14464"`, `Sklep o objavi gibanja plač za maj 2026` | `{id:153,naziv:"Objavljen akt brez datuma začetka veljavnosti"}` | one `Osnovni` entry | `{id:613486752,naziv:"Osnovni"}`; `objavljeno:"2026-07-28"` |

Exact observed `npbVerzije` identities used by compact registry fixtures:

```text
ZAKO5761: Osnovni=10882829; NPB1=11362997; NPB2=11213128; NPB3=11221930;
NPB4=10447487; NPB5=11464787; NPB6=9382488; NPB7=9485590; NPB8=10070710;
NPB9=9674822; NPB10=5202061; NPB11=9635489; NPB12=9710879; NPB13=9972309;
NPB14=10363860; NPB15=10568665; NPB16=121564298; NPB17=169849164;
NPB18=269752613; NPB19=269801239; NPB20=298532110.

ZAKO6655: Osnovni=11515968; NPB1=10574819; NPB2=10211931; NPB3=9676675;
NPB4=9677376; NPB5=9758033; NPB6=9713094; NPB7=10461768; NPB8=270729002.

SOP 2026-01-1950: Osnovni=613486752.
```

The route and companion fixtures keep these full small arrays. Reducing ZTuj-2 to an invented `NPB 2` maximum while pairing it with current Article 51.a would create false provenance and is forbidden.

The registry endpoint is a single-record, non-paginated response and currently exposes no independent `total`, `hasMore`, or continuation token for `npbVerzije`. The validator can prove that the authoritative response was received whole at the transport/JSON level and that its returned sequence is unique and gapless. It cannot prove that the authority did not itself omit a syntactically valid tail when the authority publishes no total. This is an explicit source-authority limitation, not a hidden completeness guarantee. HTTP partial content, malformed JSON, any gap/duplicate, or a future pagination/total contract that the parser does not understand must fail closed.

## PISRS Details Shape and Structural Targets

All selected details responses have `error: null` and these required paths:

```text
$.data.besedilo[].{id,vsebina,struktura,navezavaNPB}
$.data.kazalo[].{idStrukturniElement,idStrukturniElementPostavljeno,kazaloIme,struktura}
```

Unrelated fields are present and are not semantic control markers. Article boundaries come from the unique structural heading and the next article heading, with the matching `kazalo` identity as a second binding.

Observed target `kazalo` bindings:

| Target | `idStrukturniElement` | `idStrukturniElementPostavljeno` | Normalized `kazaloIme` / `struktura` |
| --- | ---: | ---: | --- |
| ZTuj-2 Article 51.a | 358811956 | 358811967 | `51.a člen (dovoljenje za začasno prebivanje za digitalnega nomada)` / `clen` |
| ZTuj-2 Article 55 | 358812008 | 358812031 | `55. člen (zavrnitev izdaje dovoljenja za prebivanje)` / `clen` |
| ZZSDT Article 32 | 422791324 | 422791326 | `32. člen (splošna določba)` / `clen` |
| ZZSDT Article 33 | 422791327 | 422791336 | `33. člen (zaposlovanje)` / `clen` |
| Salary publication title | 613963148 | 613963148 | `Sklep o objavi gibanja plač za maj 2026` / `naslov` |

### Exact normalized retained `besedilo`

For fixtures, HTML tags are removed, non-breaking spaces become ordinary spaces, and whitespace runs collapse to one space. The following strings are the complete normalized values retained from the recorded responses; they are not translations or summaries.

ZTuj-2 Article 51.a:

```json
[
  {"id":358811956,"struktura":"clen","vsebina":"51.a člen","navezavaNPB":"Datum začetka uporabe: 21.11.2025"},
  {"id":358811957,"struktura":"clen","vsebina":"(dovoljenje za začasno prebivanje za digitalnega nomada)","navezavaNPB":null},
  {"id":358811958,"struktura":"odstavek","vsebina":"(1) Tujcu se lahko izda dovoljenje za začasno prebivanje za digitalnega nomada, če:","navezavaNPB":null},
  {"id":358811959,"struktura":"alinea_za_odstavkom","vsebina":"- ni državljan EU ali državljan države članice Evropskega gospodarskega prostora in je zaposlen ali opravlja delo na podlagi sklenjene pogodbe civilnega prava pri poslovnem subjektu s sedežem izven Republike Slovenije ali opravlja delo kot samozaposlena oseba v tujini, pri čemer delo opravlja na daljavo prek komunikacijske tehnologije,","navezavaNPB":null},
  {"id":358811960,"struktura":"alinea_za_odstavkom","vsebina":"- ima veljavno potno listino, katere veljavnost je najmanj tri mesece daljša od nameravanega prebivanja v Republiki Sloveniji,","navezavaNPB":null},
  {"id":358811961,"struktura":"alinea_za_odstavkom","vsebina":"- ima ustrezno zdravstveno zavarovanje, ki krije vsaj nujne zdravstvene storitve na območju Republike Slovenije,","navezavaNPB":null},
  {"id":358811962,"struktura":"alinea_za_odstavkom","vsebina":"- ima zadostna sredstva za preživljanje v času prebivanja v državi, mesečno najmanj v višini dvakratnika povprečne mesečne neto plače v Republiki Sloveniji, nazadnje objavljene v Uradnem listu Republike Slovenije,","navezavaNPB":null},
  {"id":358811963,"struktura":"alinea_za_odstavkom","vsebina":"- ne obstajajo razlogi za zavrnitev izdaje dovoljenja za prebivanje iz prve, druge, tretje, četrte, pete, šeste, sedme, devete, desete, enajste ali dvanajste alineje prvega odstavka 55. člena tega zakona.","navezavaNPB":null},
  {"id":358811964,"struktura":"odstavek","vsebina":"(2) Tujec mora prošnjo za izdajo dovoljenja za začasno prebivanje za digitalnega nomada vložiti pri diplomatskem predstavništvu ali konzulatu Republike Slovenije v tujini, če zakonito prebiva v Republiki Sloveniji na podlagi veljavne osebne izkaznice oziroma veljavnega potnega lista ali na podlagi veljavnega potnega lista in dovoljenja za prebivanje, ki ga izda druga država članica Evropske unije, ali na podlagi vizuma C, ki ga izda pristojni organ Republike Slovenije ali druga država pogodbenica Konvencije o izvajanju schengenskega sporazuma z dne 14. junija 1985, ali vizuma D, ki ga izda druga država pogodbenica Konvencije o izvajanju schengenskega sporazuma z dne 14. junija 1985, pa lahko vloži prošnjo tudi pri pristojnem organu v Republiki Sloveniji.","navezavaNPB":null},
  {"id":358811965,"struktura":"odstavek","vsebina":"(3) Tujec iz prejšnjega odstavka, ki zakonito prebiva v Republiki Sloveniji, mora prošnjo za izdajo dovoljenja za začasno prebivanje za digitalnega nomada vložiti pri pristojnem organu v Republiki Sloveniji pred potekom dovoljenega prebivanja v Republiki Sloveniji. O pravočasno vloženi prošnji pri pristojnem organu v Republiki Sloveniji pristojni organ tujcu izda potrdilo, ki velja kot dovoljenje za začasno prebivanje do dokončne odločitve o prošnji. Izdano potrdilo dovoljuje tujcu prebivanje v Republiki Sloveniji kot digitalnemu nomadu. Tujcu, ki je vložil prošnjo za izdajo prvega dovoljenja za začasno prebivanje za digitalnega nomada pri pristojnem organu v Republiki Sloveniji, se dovoljenje za začasno prebivanje, odločba o zavrnitvi izdaje dovoljenja, sklep o ustavitvi postopka in sklep o zavrženju prošnje, izdan v postopku izdaje dovoljenja za začasno prebivanje, vroči pri organu, ki je dovoljenje izdal.","navezavaNPB":null},
  {"id":358811966,"struktura":"odstavek","vsebina":"(4) Dovoljenje za začasno prebivanje za digitalnega nomada se izda za čas trajanja pogodbe o zaposlitvi ali pogodbe civilnega prava, vendar ne dlje kot za eno leto, samozaposlenemu pa za obdobje enega leta oziroma za čas nameravanega prebivanja, če je ta krajši, in v obliki iz 58. člena tega zakona, pri čemer se pri vrsti dovoljenja vpiše »digitalni nomad«.","navezavaNPB":null},
  {"id":358811967,"struktura":"odstavek","vsebina":"(5) Dovoljenja za začasno prebivanje za digitalnega nomada ni mogoče podaljšati, lahko pa tujec za dovoljenje za začasno prebivanje za digitalnega nomada ponovno zaprosi po šestih mesecih od poteka veljavnosti dovoljenja za začasno prebivanje za digitalnega nomada.","navezavaNPB":null}
]
```

ZTuj-2 Article 55:

```json
[
  {"id":358812008,"struktura":"clen","vsebina":"55. člen","navezavaNPB":null},
  {"id":358812009,"struktura":"clen","vsebina":"(zavrnitev izdaje dovoljenja za prebivanje)","navezavaNPB":null},
  {"id":358812010,"struktura":"odstavek","vsebina":"(1) Dovoljenje za prebivanje v Republiki Sloveniji se tujcu ne izda, če:","navezavaNPB":null},
  {"id":358812011,"struktura":"alinea_za_odstavkom","vsebina":"- niso izpolnjeni pogoji iz tretjega in četrtega odstavka 33. člena tega zakona;","navezavaNPB":null},
  {"id":358812012,"struktura":"alinea_za_odstavkom","vsebina":"- obstajajo razlogi za domnevo, da tujec ne bo prebival na ozemlju Republike Slovenije, razen v primeru, ko je tujec s strani delodajalca s sedežem v Republiki Sloveniji, pri katerem je v delovnem razmerju, v času trajanja delovnega razmerja, zaradi opravljanja storitev napoten na delo v tujino;","navezavaNPB":null},
  {"id":358812013,"struktura":"alinea_za_odstavkom","vsebina":"- je tujcu prepovedan vstop v državo;","navezavaNPB":null},
  {"id":358812014,"struktura":"alinea_za_odstavkom","vsebina":"- obstajajo razlogi za domnevo, da tujec po izteku veljavnosti dovoljenja ne bo prostovoljno zapustil Republike Slovenije;","navezavaNPB":null},
  {"id":358812015,"struktura":"alinea_za_odstavkom","vsebina":"- obstajajo razlogi za sum, da utegne pomeniti nevarnost za javni red in varnost ali mednarodne odnose Republike Slovenije ali obstaja sum, da bo njegovo prebivanje v državi povezano z izvajanjem terorističnih ali drugih nasilnih dejanj, nezakonitimi obveščevalnimi dejavnostmi, proizvodnjo ali prometom z drogami ali izvrševanjem drugih kaznivih dejanj;","navezavaNPB":null},
  {"id":358812016,"struktura":"alinea_za_odstavkom","vsebina":"- obstajajo razlogi za domnevo, da se tujec ne bo podrejal pravnemu redu Republike Slovenije;","navezavaNPB":null},
  {"id":358812017,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje prvega dovoljenja za prebivanje ugotovi, da obstajajo resni razlogi za domnevo, da utegne biti tujec v času svojega prebivanja v Republiki Sloveniji žrtev trgovine z ljudmi;","navezavaNPB":null},
  {"id":358812018,"struktura":"alinea_za_odstavkom","vsebina":"- je očitno, da je bila zakonska zveza, partnerska skupnost oziroma partnerska zveza sklenjena ali registrirana predvsem z namenom pridobitve dovoljenja za prebivanje, ali če se v postopku podaljšanja dovoljenja za začasno prebivanje ali izdaje dovoljenja za stalno prebivanje ugotovi, da družinski član dejansko ne živi v družinski skupnosti s tujcem, kateremu ta zakon priznava pravico do združitve družine;","navezavaNPB":null},
  {"id":358812019,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje prvega dovoljenja za začasno prebivanje ugotovi, da tujec dejansko že živi v Republiki Sloveniji iz drugačnih razlogov, kot je to mogoče na podlagi vizuma;","navezavaNPB":null},
  {"id":358812020,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje prvega dovoljenja za začasno prebivanje ugotovi, da prihaja z območij, kjer razsajajo nalezljive bolezni z možnostjo epidemije, navedene v mednarodnih zdravstvenih pravilih Svetovne zdravstvene organizacije, oziroma z območij, kjer razsajajo nalezljive bolezni, ki bi lahko ogrozile zdravje ljudi in za katere je v skladu z zakonom, ki ureja nalezljive bolezni, treba sprejeti predpisane ukrepe;","navezavaNPB":null},
  {"id":358812021,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje prvega dovoljenja za začasno prebivanje ugotovi, da je bila tujcu v zadnjih šestih mesecih pred vložitvijo prošnje za izdajo dovoljenja zavrnjena izdaja vizuma zaradi nevarnosti za javni red, varnost ali mednarodne odnose Republike Slovenije ali zaradi suma, da bo njegovo prebivanje v državi povezano z izvajanjem terorističnih ali drugih nasilnih dejanj, nezakonitimi obveščevalnimi dejavnostmi, proizvodnjo ali prometom z drogami ali izvrševanjem drugih kaznivih dejanj;","navezavaNPB":null},
  {"id":358812022,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje ali podaljšanja dovoljenja za prebivanje ugotovi, da je bilo katero koli dokazilo o izpolnjevanju pogojev za izdajo ali podaljšanje dovoljenja za prebivanje prirejeno ali ponarejeno;","navezavaNPB":null},
  {"id":358812023,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje ali podaljšanja dovoljenja za prebivanje ugotovi, da je bil subjekt gostitelj ustanovljen zlasti zaradi omogočanja vstopa osebam, premeščenim znotraj gospodarske družbe;","navezavaNPB":null},
  {"id":358812024,"struktura":"alinea_za_odstavkom","vsebina":"- se v postopku izdaje ali podaljšanja dovoljenja za prebivanje ugotovi, da je bilo delodajalčevo podjetje ustanovljeno ali deluje predvsem z namenom olajšanja vstopa državljanom tretjih držav v Republiko Slovenijo.","navezavaNPB":null},
  {"id":358812025,"struktura":"odstavek","vsebina":"(2) Pristojni organ obstoj razlogov iz prve alinee prejšnjega odstavka glede zadostnih sredstev za preživljanje ugotavlja tudi na podlagi podatkov iz evidenc, ki jih vodi davčni organ o dohodkih skladno z zakonom, ki ureja dohodnino, ki niso oproščeni plačila dohodnine, o davku in obveznih prispevkih za socialno varnost ter o normiranih oziroma dejanskih stroških, ki se nanašajo na te dohodke in o vzdrževanih družinskih članih ter so označeni kot davčna tajnost. Pristojni organ mora podatke, ki so davčna tajnost, varovati v skladu z zakonom, ki ureja davčni postopek.","navezavaNPB":null},
  {"id":358812026,"struktura":"odstavek","vsebina":"(3) Pristojni organ obstoj razlogov za zavrnitev izdaje dovoljenja iz pete ali šeste alinee prvega odstavka tega člena ugotavlja tudi na podlagi podatkov iz kazenske evidence, evidence pravnomočnih sodb oziroma sklepov o prekrških, ki jo v Republiki Sloveniji vodi ministrstvo, pristojno za pravosodje, evidenc o pravnomočnih odločbah o prekrških, ki jih vodijo prekrškovni organi, podatkov o vloženih pravnomočnih obtožnicah in izdanih nepravnomočnih sodbah, ki jih vodi pristojno sodišče ter na podlagi podatkov iz evidenc, ki jih vodi davčni organ o zapadlih neplačanih davčnih obveznostih in o davčnih prekrških ter so označeni kot davčna tajnost. Pristojni organ mora podatke, ki so davčna tajnost, varovati v skladu z zakonom, ki ureja davčni postopek. Podatke iz navedenih evidenc pristojni organ pridobi po uradni dolžnosti.","navezavaNPB":null},
  {"id":358812027,"struktura":"odstavek","vsebina":"(4) Pristojni organ obstoj razlogov za zavrnitev izdaje dovoljenja iz pete ali šeste alinee prvega odstavka tega člena lahko ugotavlja tudi na podlagi podatkov, pridobljenih iz uradnih evidenc ali javnih listin drugih držav.","navezavaNPB":null},
  {"id":358812028,"struktura":"odstavek","vsebina":"(5) V postopku izdaje ali podaljšanja dovoljenja za začasno prebivanje družinskemu članu mora pristojni organ v primeru, ko obstoji razlog za zavrnitev izdaje ali podaljšanja dovoljenja upoštevati naravo in trdnost družinskega razmerja, dolžino njegovega prebivanja v Republiki Sloveniji ter obstoj družinskih, kulturnih in socialnih vezi z matično državo.","navezavaNPB":null},
  {"id":358812029,"struktura":"odstavek","vsebina":"(6) V odločbi, s katero pristojni organ zavrne prošnjo za izdajo ali podaljšanje dovoljenja za prebivanje iz razlogov, določenih v peti alinei prvega odstavka tega člena, ali iz razlogov, določenih v šesti alinei prvega odstavka tega člena, če se ti nanašajo na neupoštevanje predpisov, ki urejajo vstop in prebivanje tujcev v Republiki Sloveniji, lahko pristojni organ določi, koliko časa je tujcu prepovedan vstop v državo. Čas, za katerega je tujcu prepovedan vstop v državo, ne more biti krajši od enega leta in ne daljši od petih let. Pri presoji, koliko časa je tujcu prepovedan vstop v državo, organ, ki izda odločbo o zavrnitvi, upošteva vrsto in težo okoliščin, zaradi katerih je tujčevo prebivanje v Republiki Sloveniji nezaželeno.","navezavaNPB":null},
  {"id":358812030,"struktura":"odstavek","vsebina":"(7) Po pravnomočnosti odločbe o zavrnitvi prošnje za izdajo dovoljenja za prebivanje, s katero je bil tujcu prepovedan tudi vstop v Republiko Slovenijo, pristojni organ prepoved vstopa sporoči organu, pristojnemu za vnos podatkov v schengenski informacijski sistem.","navezavaNPB":null},
  {"id":358812031,"struktura":"odstavek","vsebina":"(8) Podrobnejšo opredelitev podatkov o dohodkih iz drugega odstavka tega člena, ki jih zagotavlja davčni organ ter način ugotavljanja in preverjanja izpolnjevanja pogoja zadostnih sredstev za preživljanje, določi minister, pristojen za notranje zadeve, v soglasju z ministrom, pristojnim za finance.","navezavaNPB":null}
]
```

ZZSDT Articles 32–33:

```json
[
  {"id":422791324,"struktura":"clen","vsebina":"32. člen","navezavaNPB":null},
  {"id":422791325,"struktura":"clen","vsebina":"(splošna določba)","navezavaNPB":null},
  {"id":422791326,"struktura":"odstavek","vsebina":"Tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, in ki mu ni prepovedano zaposlovanje, samozaposlovanje in delo v skladu z 42. členom tega zakona, se lahko zaposli, samozaposli ali dela v skladu z določbami tega poglavja, razen tujcev, ki imajo pravico do prostega dostopa na slovenski trg dela na podlagi tega zakona.","navezavaNPB":null},
  {"id":422791327,"struktura":"clen","vsebina":"33. člen","navezavaNPB":null},
  {"id":422791328,"struktura":"clen","vsebina":"(zaposlovanje)","navezavaNPB":null},
  {"id":422791329,"struktura":"odstavek","vsebina":"(1) Tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, se lahko zaposli le na delovnem mestu, za katerega v evidenci brezposelnih oseb ni ustreznih brezposelnih oseb, razen v primeru opravljanja dela zastopnika.","navezavaNPB":null},
  {"id":422791330,"struktura":"odstavek","vsebina":"(2) V primeru, da v evidenci brezposelnih oseb ni vpisanih ustreznih kandidatov, zavod v petih delovnih dneh od sporočila o prostem delovnem mestu delodajalcu, upravni enoti ter pristojnemu nadzornemu organu o tem posreduje pisno obvestilo ter informativni list, na katerem so navedeni vsi pogoji in elementi zaposlitve, ki jih je delodajalec opredelil v sporočilu. V primeru zaposlitve tujca za opravljanje dela zastopnika in tujca, ki je bil predhodno že zakonito zaposlen pri istem delodajalcu na istem delovnem mestu, se informativni list izda brez preverjanja obstoja ustreznih brezposelnih oseb v evidenci zavoda.","navezavaNPB":null},
  {"id":422791331,"struktura":"odstavek","vsebina":"(3) Če so v evidenci brezposelnih oseb vpisani ustrezni kandidati, zavod v petih delovnih dneh od sporočila o prostem delovnem mestu o tem pisno obvesti delodajalca.","navezavaNPB":null},
  {"id":422791332,"struktura":"odstavek","vsebina":"(4) Tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, je lahko zaposlen le na podlagi veljavne izkaznice dovoljenja za prebivanje, na kateri je označena pravica do dela, kateri upravna enota ob vročitvi priloži tudi informativni list. Do izdaje izkaznice dovoljenja za prebivanje, na kateri je označena pravica do dela, se tujec lahko zaposli in vključi v obvezna socialna zavarovanja na podlagi veljavne izkaznice dovoljenja za prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, in informativnega lista iz drugega odstavka tega člena.","navezavaNPB":null},
  {"id":422791333,"struktura":"odstavek","vsebina":"(5) Pisno obvestilo iz drugega odstavka tega člena se šteje kot dokazilo o izpolnjenem pogoju iz prvega odstavka tega člena, če tujec nastopi delo v roku 30 dni od izdaje pisnega obvestila. V času trajanja delovnega razmerja morajo biti izpolnjeni vsi pogoji in elementi zaposlitve, navedeni na informativnem listu.","navezavaNPB":null},
  {"id":422791334,"struktura":"odstavek","vsebina":"(6) Tujec je lahko še naprej zaposlen pri istem delodajalcu tudi v času, ko v Republiki Sloveniji prebiva na podlagi potrdila o pravočasno vloženi prošnji za podaljšanje dovoljenja za prebivanje ali za izdajo nadaljnjega dovoljenja za prebivanje, izdanega na podlagi zakona, ki ureja vstop in prebivanje tujcev, vendar izključno pod pogoji in v obsegu, kot mu je bilo dovoljeno s predhodnim dovoljenjem za prebivanje.","navezavaNPB":null},
  {"id":422791335,"struktura":"odstavek","vsebina":"(7) Ne glede na določbo prvega odstavka tega člena se tujec z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, lahko zaposli tudi v primerih, ki jih minister, pristojen za delo, določi na podlagi sedmega ali osmega odstavka 17. člena tega zakona.","navezavaNPB":null},
  {"id":422791336,"struktura":"odstavek","vsebina":"(8) Za potrebe izdaje izkaznice dovoljenja za začasno prebivanje, na kateri je označena pravica do dostopa na trg dela, ki se izdaja na podlagi zakona, ki ureja vstop in prebivanje tujcev, v primeru iz drugega odstavka tega člena posebna odločitev zavoda o pravici do dostopa na trg dela ni potrebna.","navezavaNPB":null}
]
```

Salary publication target and disambiguating siblings:

```json
[
  {"id":613963148,"struktura":"naslov","vsebina":"Sklep o objavi gibanja plač za maj 2026","navezavaNPB":null},
  {"id":613963149,"struktura":"odstavek","vsebina":"Povprečna mesečna bruto plača na zaposleno osebo v Sloveniji za maj 2026 je znašala 2.682,36 EUR in je bila za 0,5 % nižja kot za april 2026.","navezavaNPB":null},
  {"id":613963150,"struktura":"odstavek","vsebina":"Povprečna mesečna neto plača na zaposleno osebo v Sloveniji za maj 2026 je znašala 1.680,80 EUR in je bila za 0,5 % nižja kot za april 2026.","navezavaNPB":null},
  {"id":613963151,"struktura":"odstavek","vsebina":"Povprečna mesečna bruto plača za obdobje januar–maj 2026 je znašala 2.658,34 EUR.","navezavaNPB":null},
  {"id":613963152,"struktura":"odstavek","vsebina":"Povprečna mesečna neto plača za obdobje januar–maj 2026 je znašala 1.668,75 EUR.","navezavaNPB":null},
  {"id":613963153,"struktura":"odstavek","vsebina":"Povprečna mesečna bruto plača za obdobje marec–maj 2026 je znašala 2.685,23 EUR.","navezavaNPB":null},
  {"id":613963154,"struktura":"evidencna_stevilka","vsebina":"Št. 9616-370/2026","navezavaNPB":null}
]
```

### ZTuj-2 route targets

- Article `51.a člen` starts at item `358811956`, `struktura:"clen"`; its applicability field is exactly `Datum začetka uporabe: 21.11.2025`.
- The immediately following relevant items are subtitle `358811957`, opening paragraph `358811958`, and requirement items `358811959` through `358811963`.
- The returned text explicitly names non-EU/non-EEA scope, foreign employment or civil contract, foreign self-employment, remote ICT work, passport validity plus three months, health insurance, twice the latest official average monthly net salary, and the enumerated Article 55 refusal grounds.
- Duration paragraphs are items `358811966` and `358811967`: at most one year, no extension, and a new application after six months.
- Article `55. člen` starts at item `358812008`; its opening and first-paragraph refusal grounds start at `358812009` and `358812010`.

### ZZSDT companion-work targets

- Article `32. člen` starts at item `422791324`; paragraph `422791326` says a qualifying holder of a temporary permit not issued for work may work only under that chapter.
- Article `33. člen` starts at item `422791327`.
- Paragraph `422791329` requires no suitable unemployed person for the job, subject to the stated exceptions.
- Paragraph `422791330` requires the written notice and `informativni list` when the condition is met.
- Paragraph `422791332` binds employment to the residence card/work notation or the valid card plus information sheet during issuance.
- These current target items expose `navezavaNPB: null`; the honest source period is therefore the selected identity `ZAKO6655:NPB 8`, not an invented effective date.

### Salary-publication target

- The selected title item is `613963148`: `Sklep o objavi gibanja plač za maj 2026`.
- The unique monthly net item is `613963150`: `Povprečna mesečna neto plača ... za maj 2026 ... 1.680,80 EUR`.
- The gross, January–May, and rolling-period values are distinct sibling items and must not be selected as the monthly net metric.
- The signature block includes `Ljubljana, dne 22. julija 2026`; registry publication remains the machine cutoff field.

## GOV.SI Human Route Shape

After removing `script`, `style`, and `noscript`, the compact fixture retains this exact normalized `h1`/date/paragraph sequence:

```text
Temporary residence permit for digital nomads
21. 11. 2025
In Slovenia, a digital nomad is defined as a foreigner who is not a citizen of an EU or EEA country and who is either employed or performs work under a civil-law contract for a business entity based outside Slovenia or works as a self-employed person abroad, with all such work carried out remotely via information and communication technologies. The essential point is that the foreigner is not entering the Slovenian labour market. As a result, labour-market admission requirements do not apply to them (they do not need the permit normally issued by the Employment Service of Slovenia).
Foreign nationals have to apply for a temporary residence permit for digital nomads at any diplomatic representation or consular post of the Republic of Slovenia abroad. Those already legally residing in Slovenia may also submit their application at any administrative unit in Slovenia.
A temporary residence permit for digital nomads may be issued for up to one year and cannot be extended, reflecting the highly mobile nature of this category of foreigners, who usually stay in a country only for a limited period (for example, during the summer season). A foreigner may reapply for a temporary residence permit for digital nomads six months after the expiry of their previous permit. However, if a digital nomad decides that they wish to continue residing in Slovenia (for example, because they wish to take up employment in the country), they may apply at any time during the validity of their digital-nomad temporary residence permit for another type of temporary residence permit based on a different purpose of stay.
To meet the requirement for sufficient means of subsistence, the foreigner must have monthly funds amounting to at least twice the average monthly net salary in Slovenia, calculated on the basis of the average monthly gross salary most recently published in the Official Gazette of the Republic of Slovenia. Proof of meeting this requirement may be provided through any lawful sources of income, as is the case for all other categories of foreigners.
A notable feature of the temporary residence permit for digital nomads is the more favourable family-reunification regime. Digital nomads may reunite with their family members immediately, without any restrictions linked to the duration of the foreigner’s residence in Slovenia or the validity of their permit.
```

The HTML is corroborating human-readable evidence. PISRS remains the authoritative legal-text surface for statutory claims.

## ESS Human Procedure Shape

After the same normalization, the compact fixture retains this exact target sequence (duplicate responsive title nodes collapse to one fixture heading):

```text
Zaposlitev tujcev z dovoljenjem za prebivanje
Tujci z dovoljenjem za začasno prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, pač pa na primer zaradi združitve družine, študija ali drugih razlogov, se lahko zaposlijo na podlagi pridobljenega informativnega lista.
Informativni list izdamo na območni službi Zavoda v skladu Zakonom o zaposlovanju, samozaposlovanju in delu tujcev (ZZSDT, 33. člen).
Kakšen je postopek zaposlitve?
2. Delodajalci pri našem pristojnem uradu za delo razpišete prosto delovno mesto na obrazcu PDM-KTD in označite točko b) nova zaposlitev tujca z dovoljenjem za prebivanje, ki ni izdano zaradi zaposlitve ali dela.
3. Na Zavodu preverimo trg dela.
4. Če v evidenci brezposelnih ni ustreznih kandidatov, v 5 delovnih dneh posredujemo pisno obvestilo in informativni list vam kot delodajalcu, upravni enoti in inšpektoratu. Na informativnem listu so navedeni vsi elementi in pogoji zaposlitve.
Na podlagi informativnega lista bo upravna enota izdala tujcu novo izkaznico dovoljenja za prebivanje, na kateri bo pripisana pravica do dostopa na trg dela. Hkrati bo tujec prejel še pri upravni enoti potrjen informativni list.
Do izdaje izkaznice dovoljenja za prebivanje, na kateri je označena pravica do dela, se tujec lahko zaposli in vključi v obvezna socialna zavarovanja na podlagi veljavne izkaznice dovoljenja za prebivanje, ki ni izdano zaradi zaposlitve, samozaposlitve ali dela, in informativnega lista.
```

ESS is procedure corroboration. Articles 32–33 in the selected ZZSDT text remain the statutory source.

## SiStat Metadata and JSON-stat2 Shape

Metadata title: `Average monthly earnings by MONTH and EARNINGS`.

| Dimension | Text / time | Observed categories |
| --- | --- | --- |
| `MESEC` | `MONTH`, `time:true` | 245 unique periods from `2006M01` through `2026M05` |
| `PLAČE` | `EARNINGS`, no time flag | `1` Gross earnings; `2` Net earnings; `3` Average gross earnings for the last three months; `4` Average net earnings for the last three months |

The JSON-stat2 response has `class:"dataset"`, `version:"2.0"`, `source:"Statistical Office of the Republic of Slovenia"`, `id:["MESEC","PLAČE"]`, `size:[245,4]`, object category indexes, and exactly `980` values. At declared coordinates `MESEC=2026M05` and `PLAČE=2`, the observed value is `1680.8`. That agrees with the selected PISRS monthly-net publication and produces the observed two-times threshold `3361.60`; neither number is a production constant.

## Fixture Extraction Rules

Compact fixtures may retain only the recorded outer paths, target entries, immediately required boundary entries, and values listed above. They must preserve the source's native field names, native text, IDs, `kazalo` start/end bindings, status values, nullability, dimension order, and request provenance. They must not add `complete`, `pagination`, `datasetId`, `anchorExcerpt`, `BEGIN`, `END`, or other semantic control fields absent from the recorded official responses.

Each fixture header or adjacent test constant must cite this document, its role URL, and the recorded response hash. A fixture is test input only: live acceptance still requires a fresh official fetch and may legitimately select later NPB IDs, publication periods, or values.
