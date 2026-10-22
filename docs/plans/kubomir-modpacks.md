# «Кубомир» × сборки Minecraft: что взять как идею и в каком порядке (T-047)

План v1, 2026-10-22. Только исследование и план, кода игры нет. Данные: `E:\claude-tmp\mcpacks\inventory.json` (сборки владельца с CurseForge), локальные текстовые файлы сборок (только чтение), поиск в сети. Список модов по группам с идеями: `E:\claude-tmp\t047\mods-categorized.json` (244 записи, не в репозитории).

## Для владельца (кратко, по-русски)

1. Я разобрал 12 твоих сборок CurseForge (дубликаты SevTech и DDSS2 и пустую «1» не считаю): 1932 разных мода. Чужие файлы, картинки, звуки, код, названия и тексты в игру НЕ берём, только идеи и механики. Всё рисуем и пишем сами (на сайте реклама, репозиторий открытый). Свои .jar можно загружать только себе, в свой мир, через «📥 Из Minecraft».
2. Больше всего людям нравятся не «большие моды», а мелкие помощники. Есть почти в каждой сборке: сытость еды на полоске (AppleSkin, 10 из 12), книга рецептов «как сделать / для чего / где взять» (JEI или EMI, 11 из 12), подсказка «что это за блок и чем его ломать» (Jade, 8), мини-карта с точками (JourneyMap или Xaero, 9), кровать и спальник (Comforts, 7), лифт (6), рюкзак (5), телепорты-привалы (Waystones, 5), книга заданий с главами (FTB Quests, 7).
3. В «Кубомире» уже есть: «📖 Можно сделать», сортировка, подсказки новичку, достижения, цветной свет, паркур, две руки и бой, моды и перенос из Майнкрафта. Нет: кровати и сна, вёдер, карты и точек, подсказки под прицелом, рюкзака, привалов, лифта, глав заданий, фермы и готовки, брони, деревень, подземелий, боссов, других миров и космоса.
4. Этап 1 «Удобнее» (начинать после T-019 «кооп и сохранения» и T-044 «вода»): 16 небольших задач (K1.0–K1.15), около 15 запусков агента, в 3–4 потока. Сначала «основа» (общее место для событий и данных игрока), чтобы агенты не мешали друг другу в kubomir.js.
5. Этап 2 «Содержимое» (вместе с T-020 мобы/боссы и T-021 картинки): ферма, готовка, рыбалка; подземелья и деревни; ещё 6 биомов; декор и стёкла без швов; мобы-«элиты»; доска заказов; режим «Остров»; фото-режим.
6. Этап 3 «Системы»: механизмы с шестерёнками (как Create), инструменты из деталей, дерево навыков, заклинания, склады, постройка копированием, права и команды в коопе.
7. Этап 4 «Миры и космос»: порталы, карманный дом, ракеты Луна → Марс → Венера с кислородом (как в DDSS2). Формат планеты общий со «Вселенной» (шаг 7), чтобы не делать космос дважды.
8. Правила: одинаково на телефоне, ПК и геймпаде; всё данными (моды добавляют свои записи); у каждой правки замер на «слабом телефоне». За деньги силы нет: 💎 только облики (например, скин рюкзака).
9. Награды книги заданий НЕ дают новых 🪙 и XP сверх лимитов сайта (красные линии): только вещи в мире, открытые рецепты и облики.
10. Ужастики (как Cave Horror и Endless Horror): только по желанию, метка 12+/16+, без крови, режим «Свет» всё смягчает. Чужие страшилки (SCP, Rake, Херобрин) не берём: чужие права.
11. Для денег и трафика: страницы «Рецепты Кубомира» для поиска («как сделать X») из тех же данных игры; режим «Остров» и фото-режим со ссылкой дают повод делиться.
12. Нужно от тебя 5 решений (раздел 7): помощники «сразу» или «открывать за прогресс»; нужен ли режим ужасов; цена привала (еда или пауза); карта в выживании сразу или по предмету; делаем ли страницы рецептов для поиска.
13. Добавлено 22.10: идеи переносим и в другие игры. В таблицах §2 есть колонка «Где ещё» (Подземье, Мир Денчика, Студия 3D, Орда/Башни/Арена/io). Логика пишется один раз в общих модулях движка (книга заданий, книга рецептов, карта и точки, бестиарий, добыча и постройки, привалы), в каждой игре остаётся тонкий «переходник». Список модулей и порядок — раздел 3.3.
14. Где что: этот файл `docs/plans/kubomir-modpacks.md`; 244 мода по группам с идеями `E:\claude-tmp\t047\mods-categorized.json` (рядом, не в репозитории).

---

## 0. Scope, rules, method

### 0.1 What this is
A research-and-plan document for agents (T-047). No game code is written here. Other agents are editing Kubomir and the engine now (T-019 co-op and cloud saves, T-044 water, T-042 engine controls, T-043 menus), so every spec below names the files it touches and keeps new code in new files behind one small seam (§4.0).

### 0.2 Legal and naming rule (public repo, ads on the site)
- Ideas and mechanics only. Never copy textures, models, sounds, code, structure files, quest text, translations or mod names into the game or its data. Kubomir draws its own textures by code (`docs/KUBOMIR_ART.md`) and writes its own text.
- Mod names in this document are traceability labels (where an idea was seen), the same practice as `docs/COMBAT.md` and the Universe spec §13. **Our in-game names, icons, sounds and texts must be our own** (for example «Привал», not the source mod's word; new art, new wording).
- Structures, dungeons, villages, quest chapters, loot tables, mob models: authored by us (procedural grammar plus hand-written templates). The importer in «📥 Из Minecraft» stays a personal tool: the owner may import his own jars/worlds into his own local world; nothing imported is shipped or published.
- Third-party IP stays out even as an "idea": SCP-style entities, Rake, Herobrine-style creepypasta, named anime/film characters (Solo Leveling), Doctor Who angels, Dead Cells. We keep only the underlying generic mechanic (for example "freezes while watched"), with our own creature.
- Violence red line (master instruction): no blood, no gore, knockout and fade instead of death. Packs themed on blood magic, sacrifice, vampirism are not adopted for a 6+ game.

### 0.3 Constraints every item must pass (from CLAUDE.md)
- Same gameplay on phone, PC and pad: fixed step, forces per second, input as action state. Each new feature gets an action id, a PC key, a pad button and a visible phone button (§5.2). Automated invariance test at 30/60/144 FPS for anything that changes gameplay state.
- No paid randomness, no pay-to-win. 💎 buys looks only (backpack skins, map styles, camp skins). 🪙 and XP rewards stay inside the existing caps (`coin_run_cap('kubomir')` 15, `game_win_xp` 4); quest rewards are in-world items, unlocked recipes and cosmetics only.
- No dark patterns: no pressure timers, hidden prices or hard-to-cancel flows. Daily jobs never punish skipping.
- Age: Kubomir is 6+. Fights are cartoon. Horror is an opt-in world mode labelled 12+ (strong effects 16+), off by default; under-13 needs the existing "adult allowed" path (`D37Age.canOpen`).
- User text through `textContent` only (waypoint names, camp names, quest notes). Names go through `IoKit.cleanName`-style filtering (bad words, links, phones, @nicks).
- Data-driven and moddable: each feature reads plain JSON that the mod format (`docs/MODS.md`) can extend additively (`api` stays 1; new fields are ignored by old games).
- Shared first (owner 22.10): each idea is built once as a `D37E.*` engine module or a shared data catalog with a thin adapter per game (§3.3); «Подземье», «Мир Денчика», «Студия 3D» and the small games (Орда, Башни, Арена, io) get it through adapters. Column «Где ещё» in §2.
- Quality bar (owner 22.10): numbers before/after on the phone profile (CPU x4, "mid"), no garbage per frame in hot loops, no leaks (20 open/close), a 10-minute run without errors, a safe fallback if a feature fails (the game keeps running).

### 0.4 Method
1. Frequency: counted from `inventory.json` per mod id, merged duplicate instances (SevTech and DDSS2 are listed twice, so the file's own `packs` field overcounts; all numbers below are **distinct packs out of 12**). 1932 unique mods; 285 appear in 3+ packs; 680 in 2+; the most widespread single mod is in 11.
2. Category: CurseForge category ids from the file (Library 198, Miscellaneous 188, Cosmetic 170, Adventure/RPG 136, Utility/QoL 116, Mobs 97, Armor/Tools/Weapons 95, Technology 91, Server Utility 89, Addons 80, Resource packs 69, Structures 64, Storage 53, World Gen 52, Map/Information 50, Magic 44, Food 35, Performance 24, Player Transport 19, Dimensions 14, Farming 16 and the rest).
3. Descriptions: the file has empty summaries, so what each mod does comes from general knowledge, checked on the web for about twenty (marked **(W)**) and from design evidence in the owner's instance files (quest chapters, KubeJS/CraftTweaker scripts, stage configs; structure and names only, nothing copied).
4. Selection: the roughly 85 most relevant non-library mods (high frequency or a distinctive mechanic), grouped A to H. The long tail is in the JSON.
5. Limits: GT New Horizons lists only 36 jars (its core bundles the rest), so its tech tree is not represented. Frequency says what pack authors put in packs, not how much players use it; where possible I note the evidence (a script, a quest chapter, a stage gate).

### 0.5 The 12 packs
| Short | Pack | MC / loader | Jars listed | What it teaches us |
|---|---|---|---|---|
| ATM10 | All the Mods 10 | 1.21.1 NeoForge | 399 | kitchen sink; about 45 quest chapters, one per big mod; a dedicated mining dimension; tooltip scripts that say where each ore is and which tier mines it |
| CRAFT | Craftoria | 1.21.1 NeoForge | 371 | tech and magic; 23 chapters plus a completionist chapter |
| DDSS2 | Dungeons Dragons and Space Shuttles 2 | 1.16.5 Forge | 332 | hardcore tiered questline Tier 0 to 6, 25+ dimensions (W), Moon/Mars/Venus at tiers 4-6; JEI info pages for ores and foods |
| PRM2 | Prominence II RPG | 1.20.1 Fabric | 449 | RPG: own talent tree (10 "fates", 16 passives, 5 actives, 100 stat talents, a point every 2 levels, W), level-scaled enemies, two story campaigns, tech optional |
| DRK1 | DarkRPG (Magic Origins) | 1.20.1 Fabric | 446 | classes/origins, bosses, bounties, trinkets; many tiny "RPG" utility mods |
| DRK2 | DarkRPG (Vampires, Dragons) | 1.20.1 Forge | 275 | vampire/werewolf, dragon mounts, bounties, passive skill tree |
| SOLO | Solo Leveling: Reawakening | 1.20.1 Forge | 217 | hunter ranks E to S, timed gates/dungeons, shadow army, daily and secret quests, parties, a 20-floor castle (W) |
| SB3 | FTB StoneBlock 3 | 1.18.2 Forge | 224 | start inside solid stone; a chapter per tech/magic mod; reward tables; sky-block bits |
| SEV | SevTech: Ages | 1.12.2 Forge | 257 | advancement-driven ages; per-player stages gate items, recipes, ores, mobs, dimensions, even the map and the tooltip HUD |
| GTNH | GT New Horizons | 1.7.10 Forge | 36 | giant tech tree (not represented) |
| CHP | Cave Horror Project | 1.20.1 Forge | 116 | horror survival: light/sanity/temperature stress, stalker mobs, a short "first night" quest chain (W) |
| EH | Endless Horror | 1.19.2 Forge | 158 | about 150 mods mostly horror: sanity meter, world corruption, VHS/insanity shaders (W) |

### 0.6 Kubomir today (verified in code 22.10; "0 hits" = word absent from `js/games/kubomir*.js`, `js/engine/voxel*.js`, `js/engine/mc-*.js`)
| Area | Has | Missing |
|---|---|---|
| World | infinite seeded world, 10 biomes, caves/ravines/lakes/trees, genVer 2, chunk 16x16x128 `Uint16 id\|state<<12`, worker streaming, seasons/weather/ice/climate zones | structures, villages, dungeons, extra biomes, portals/dimensions (0 hits for portal, dungeon, village) |
| Registry | 54 blocks `B({...})` in `voxel.js` (ids permanent, append only), about 20 plain items plus tools/food/bow/shield, recipes `R({pattern,key,out,n})` in `V.recipes` (linear scan in the grid matcher), `V.smelting` | wool/dye, slabs/stairs/panes, beds, buckets, hoe/crops, armor |
| Mobs | cow, pig, chicken, zombie, slime (`MOBS` in `kubomir-ents.js`), difficulty table, fallGroup trees, combat via `D37E.combat` | bosses, elites, villagers/trading, taming, mounts, vehicles (0 hits for villager, trade, tame, horse, boat, minecart) |
| UI | hotbar with diff-update (`hudUpdate`), inventory (`kubomir-ui.js`: `cont/setSlot/quickMove/spreadEven/collect/sort`), «📖 Можно сделать» (`U.book`), furnace/chest/craft UIs, 18 achievements (`ACH`), tip chain (`tipText`), knockout screen, «🆘 Я застрял», F3 | target info, item hover cards (0 hits for tooltip), map/waypoints/compass (0 hits), quests (0), backpack (0), sleep (0), bucket (0) |
| Input | `ACTS` table `[id, label, [key1, key2]]` in `kubomir-input.js` (stored `d37_kb_keys`), pad, touch, settings tab «🧊 Кубомир» (`D37Settings.addTab`, rows with `data-kbo`) | key search, notification categories |
| Save/meta | `metaSnap(st)` writes `player, time, day, ents, palette, spawn, modData, ice, snow`, inventory slots are `{id, n, d}` | per-feature player state (no `ext`), item extra data; `meta.bed` is read on respawn (`st.meta.bed \|\| st.meta.spawn`) but nothing ever sets it |
| Mods | `mod.json` blocks/items/recipes/worldgen/features/scripts (JS/Lua/Java sandbox), `faces/shape/sound/food/pattern`, import of schem/litematic/mca/mcworld, jar data (no code), resource packs | `info`, `mapColor`, `tags`, `quests`, new events (§5.4) |

---

## 1. What players love in these packs

Reading the numbers: the most widespread non-library mods are helpers, not content: AppleSkin 10 of 12, Mouse Tweaks 10, JEI 9, Clumps 9, Jade 8, AE2 8, Controlling 8, FTB Quests 7, JourneyMap 7, Nature's Compass 7, Toast Control 7, Comforts 7, FTB Teams 7, ModernFix 7. Pack authors treat helpers as part of the base game, ship scripts that explain where things are (ATM10, DDSS2, SevTech all carry tooltip/description scripts; DDSS2 hand-writes JEI info pages for ores and foods), and SevTech even makes the map and the tooltip HUD unlockable rewards. Counts are distinct packs out of 12.

### A. Quality of life, UI, storage, travel, building helpers
| Theme | Mods (packs) | What players get | Why it sticks |
|---|---|---|---|
| Recipe knowledge | JEI 9, EMI 4 (+EMI Loot 4, Trades 3), REI 1, Not Enough Recipe Book 3, Polymorph 6 | search every recipe, uses and drops; favorites; recipe tree and batch craft **(W)**; pick between recipes with equal inputs | "How do I make or get X?" is the first question in any crafting game; 11 of 12 packs ship a viewer |
| Looking at things | Jade 8, The One Probe 1, Neat 3, Mod Name Tooltip 2, Enchantment Descriptions 4 | name, state, contents, growth stage **(W)**; mob health; source mod; one-line help | learning with zero friction; SevTech gates the HUD as a reward |
| Places | JourneyMap 7, Xaero minimap 2 + world map 2, Antique Atlas 1, Nature's Compass 7, Explorer's Compass 3, Structures' Compass 1, Death Compass 1, Corail Tombstone 3, Grave Danger 2 | minimap, full map, per-dimension waypoints with beacons, day/night/cave map modes **(W)**; biome/structure finders; death point and grave | lost items and lost bases are the top rage-quits |
| Inventory comfort | Mouse Tweaks 10, Inventory Essentials 3, Crafting Tweaks 4, TrashSlot 5, Searchables 6, FindMe 5, Controlling 8, Toast Control 7, Configured 4, Better Advancements 5, Clickable advancements 3 | drag-split, wheel move, rotate/balance/clear buttons, trash slot, search boxes, find an item in nearby chests, key search with conflicts, quiet toasts | many small frictions; each saves hundreds of taps |
| Hunger and rest | AppleSkin 10, Comforts 7, Morpheus 2, Bed Benefits 1 | food preview on the hunger bar; sleeping bag and hammock; night skip by share of sleepers | AppleSkin teaches the hunger system without text |
| Storage and carrying | Sophisticated Backpacks 5 (+Storage 2), Iron Chests 4, Storage Drawers 3, Refined Storage 4, AE2 8, Ender Storage 3, Carry On 3, Tool Belt 2, Lootr 4 | upgradable portable storage (magnet, auto-feed, jukebox, tank **(W)**), one-search networks, per-player loot | bag space is the real limit of survival progress |
| Travel | Waystones 5, Wraith Waystones 2, Travel Anchors 2, OpenBlocks Elevator 6 | named teleports with cost and cooldown **(W)**; look-and-teleport; lifts | walking back is the second rage-quit |
| Building speed | Building Gadgets 5, Construction Wand 3, Mining Gadgets 4, Hammers 3x3 1, FTB Ultimine 5, Ore Excavation 1, Log Begone 4, Fast Leaf Decay 2, RightClickHarvest 2, Universal Bone Meal 2 | area place and break, vein and tree mining, right-click harvest | fewer repeated taps, essential on touch |
| Decor variety | Chipped 6, Rechiseled 3, Macaw's family 5-6, FramedBlocks 4, MrCrayfish Furniture 5, Handcrafted 5, Dark Utilities 6 | many shapes and variants through one station; furniture; speed pads | builders spend most hours on looks |

### B. Visuals, animation, audio
| Theme | Mods (packs) | Idea |
|---|---|---|
| Atmosphere | Complementary Reimagined 6 (+Unbound 5, BSL, MakeUp), Insanity Shader 3, Auroras 1, Falling Leaves 1, Visuality 1 | ambient layer on top of a good renderer; we already ship our own shader packs |
| Animation | Fresh Animations 3, Not Enough Animations 4, EMF/ETF 3, Better Combat 4, Combat Roll 2, Eating Animation 1, Paragliders 1, playerAnimator 7 (library) | mobs and players feel alive; directional combat; traversal toys |
| Surfaces | ConnectedTexturesMod 6, Fusion 5, Connected Glass 3 | glass and bookshelves without seams: the cheapest big visual win |
| Light and sound | Dynamic Lights 1, Presence Footsteps 1, Sound Physics Remastered 2, Extreme Sound Muffler 4, LootBeams 1 | torch in hand lights the world; footsteps by surface; cave reverb; per-category volume |
| Look slots | Cosmetic Armor Reworked 5, Immersive Armors 4, Dynamic Trim 3 | separate look from stats: the natural home for 💎 cosmetics |
| Menus/loading | FancyMenu 7, Drippy Loading Screen 3, Dark Mode Everywhere 3 | pretty loading screens (also natural ad slots on our site) |

### C. Content: mobs, bosses, structures, biomes, food
| Theme | Mods (packs) | What players get |
|---|---|---|
| Wildlife | Alex's Mobs 4, Creeper Overhaul 3, Naturalist 1, AdventureZ 2, Friends&Foes 1, Mythic Mounts 2, Dragon Mounts 1, Ice and Fire 1 | many creatures, each with one signature mechanic; biome variants of one mob |
| Bosses and elites | Bosses of Mass Destruction 2, Progressive Bosses 1, Brutal Bosses 1, Champions 2, Infernal Mobs 1, Special Mobs 1, In Control! 4 | telegraphed phases (general knowledge); elites with one affix; spawn rules as data |
| Structures | When Dungeons Arise 5, Dungeon Crawl 3, Dungeons Enhanced 2, YUNG's Better Dungeons 2, Towns and Towers 4, Yeetus Experimentus 4, Lootr 4 | a reason to explore: loot in landmarks, villages with people |
| Biomes | Biomes O' Plenty 5, Regions Unexplored 3, Oh The Biomes We've Gone 2, Tectonic 1, Deeper and Darker 2, Eternal Starlight 2 | variety of ground you walk on |
| Food and farming | Farmer's Delight 5, Farming for Blockheads 5, Cooking for Blockheads 4, Croptopia 3, Pam's HarvestCraft 2, Aquaculture 4, Serene Seasons 2, Spice of Life 2, Productive Bees 3 | the survival loop: grow, cook, buff; seasons matter |

### D. Systems: quests, staged progression, tech, magic, RPG
| Theme | Mods (packs) | Evidence and idea |
|---|---|---|
| Quest books | FTB Quests 7 (+Fabric), FTB Teams 7, Patchouli 6, Modonomicon 4, Better Advancements 5 | ATM10 about 45 chapters, Craftoria 23, DDSS2 7 tier chapters, SB3 20 chapters plus reward tables, CHP a short first-night chain. Chapters, dependency lines, checkmark tasks, item/xp/loot rewards, team claims **(W)** |
| Staged progression | Game/Item/Recipe/Dimension/Mob Stages (SEV), KubeJS 6, CraftTweaker 2 | SevTech has stages tutorial, zero..five, creative, plus mob stages and metal stages; staging scripts for containers, dimensions, enchantments, ores, mobs, **map and tooltip HUD**; progress per player **(W)** |
| Tech | Create 2, Mekanism 6, Industrial Foregoing 6, Integrated Dynamics 5, PneumaticCraft 4, Immersive Engineering 4, Thermal 3, Powah 4, Modern Industrialization 3, Pipez 4, CC: Tweaked 5, AE2 8 | automation as the long game; Create is the standout content mod (207M+ downloads in a 2026 listicle **(W)**) |
| Magic | Botania 3, Ars Nouveau 4, Iron's Spells 3, Occultism 4, Blood Magic 4, Reliquary 5, Astral Sorcery 2, Theurgy 3, EvilCraft 2 | spell crafting and mana are loved; sacrifice/blood themes are not for us |
| RPG and gear | Pufferfish's Skills 2, Attributes 2, Passive Skill Tree 1, Apotheosis 3, Tierify 2, Artifacts 5, Relics 3, Curios 5, Tinkers Construct 3, Silent Gear 2, RPG-series classes 2 | build-your-hero: skill points, rarity, trinket slots, modular tools |

### E. Dimensions and space
DDSS2 ladder (structure only, from its quest files): Tier 0 sifting and clay, Tier 1 steam/pneumatic basics, Tier 2 first extra dimension, Tier 3 oil to diesel, **Tier 4 Moon, Tier 5 Mars, Tier 6 Venus** (rocket mod plus an addon; the Prominence pack also carries a rocket addon). SevTech uses ExtraPlanets/Galacticraft; ATM10 has a mining dimension for the rarest ores (Allthemodium 2); AoA realm items and RFTools Dimensions (1 each) show "portal after progress". Pocket rooms: Hyperbox 3, Compact Machines 2, Personal Space 1. Rocket mods share one loop: tiered rocket, fuel, oxygen and suit, a sealed base, unique ores per planet **(W)**.

### F. Horror (2 packs, niche, age-gated)
CHP: stalkers that react to light (Cave Dweller, Man from the Fog, Eyes in the Darkness), haunted trees, dynamic lights, a first-night chain (wood, stone, iron, sleep through the night). EH: sanity meter, world corruption (can be turned off), VHS/insanity shaders, many third-party-IP entities. Most-used pieces are mechanics (light as a resource, sanity, being watched), not specific monsters.

### G. Multiplayer and teams
FTB Teams 7, FTB Chunks 6 (claims), FTB Ranks 5 (permissions), FTB Essentials 5 (home/warp/back), Lootr 4 (per-player loot), Simple Voice Chat 2, Chat Heads 3, Discord Rich Presence 4; SOLO adds parties. Fair loot and protection from griefing matter more than raw features.

### H. Performance (what big packs need)
ModernFix 7, FerriteCore 7, Clumps 9 (merge orbs), Entity Culling 7, Sodium 4 + Embeddium 3, ImmediatelyFast, Lithium 2, FastWorkbench 4, FastFurnace 3, AI Improvements 5, Neruina 3, spark 6 (profiler), Let Me Despawn 2, Almost Unified 3. Lesson: entities, AI ticks, recipe lookups and memory are what break big packs; we design these in from the start.

### Findings in one list
1. Helpers dominate: 10 of the 20 most widespread non-library mods are information or comfort helpers.
2. The quest book is the spine of 7 of 12 packs; the best packs also use it as the tutorial.
3. SevTech's lever is worth copying: **unlock the helpers themselves as progress** (map, tooltip HUD) for those who want it, and show them from minute one for those who do not.
4. Content mods cluster around two needs: a reason to explore (structures with loot) and a survival loop (farm, cook, fish, seasons).
5. Tech and magic are depth for veterans; for a 6+ browser game take the readable parts (power networks you can see, spell crafting) and skip the rest.
6. Horror is niche (2 packs) and must be opt-in and age-labelled.

---

## 2. Idea catalog (what we have, the gap, our better version)

How to read: **Seen in** = distinct packs out of 12. **Cost**: S about half a session of one agent (up to about 400 new lines), M about one session, L two to three. **Budget** (performance classes, measured on the phone profile CPU x4 "mid" and on desktop; baseline from T-005: render distance 8 is 59 FPS, CPU 4.3 ms, 452 draw calls):
- **HUD**: DOM/canvas only, at most +0.05 ms per frame on desktop (+0.2 ms on the phone profile), 0 extra draw calls, 0 steady-state allocations, opens in at most 30 ms (first open at most 85 ms with a warm-up like `U.warm`).
- **EVT**: logic runs on events, at most 0.3 ms per event, nothing per frame.
- **INST**: one or two instanced draw calls, at most +0.15 ms per frame.
- **WRK**: work in a worker or in slices, at most 1 ms of main-thread time per frame while loading, none when idle.
- **GFX**: shader or mesher change, only on the "Красивые/Ультра" packs unless stated, at most +0.3 ms GPU at 1080p.

Every item also obeys §0.3 (action ids for key/pad/phone, 30/60/144 FPS invariance, textContent, mod-extensible data). "Age" is the label of the feature itself.

Column **Где ещё** (owner 22.10: carry ideas to our other games): where the same idea fits in «Подземье» (Podzem), «Мир Денчика» (Мир), «Студия 3D» (Studio3D, as no-code parts, modes and scripts), Орда/Башни/Арена (Horde/TD/Arena) and io games; `[D37E.x]` names the shared module of §3.3 that carries it.

### A. Quality of life, UI, storage, travel, building
| ID | Idea (our name) | Seen in | Kubomir now | Gap → our version (phone + PC + pad, data, moddable) | Cost | Budget | Age | Где ещё |
|---|---|---|---|---|---|---|---|---|
| A1 → K1.1 | Target card «Под прицелом» | Jade 8, One Probe 1, Neat 3 | outline only | card: name, tool check green/orange/red, drops, hearts after damage, chest count, furnace and crop state; phone shows on dwell (long look) or toggle, pad compact; mods add plain `info` strings | S–M | HUD | 0+ | Podzem tile/mob card; Мир: [E] prompts get an info card (owner, price); Studio3D `info` property on parts and NPCs; Horde/TD enemy and tower cards [D37E.info] |
| A2 → K1.1 | Hover cards in inventory | Mod Name Tooltip 2, Enchantment Descriptions 4 | none | same data as A1 plus durability bar, "where to get" jump into A5, source namespace; long-press on phone | S | HUD | 0+ | Podzem and Мир inventories; Studio3D Набор items [D37E.info] |
| A3 → K1.1 | Held-item flash, clock, coordinates chip | Held Item Info 1 | none | name and durability for 1 s when the hotbar changes; optional clock and XYZ chip | S | HUD | 0+ | Podzem hotbar flash; Мир clock chip (E.dayClock); Studio3D play mode |
| A4 → K1.1 | Food preview | AppleSkin 10 | food values exist in item data | ghost icons on the hunger bar, saturation overlay, "will overflow" hint | S | HUD | 0+ | Podzem heal/food preview over hearts; Мир needs (Живой город food buff preview) |
| A5 → K1.2 | Recipe browser 2.0 | JEI 9, EMI 4, REI 1, NERB 3 | `U.book` lists only what is craftable now | one index (recipes, smelting, drops, ores, mob drops); tabs Craftable / All / Uses / Where to get / Favorites; search; works for mod recipes; creative catalog | M | HUD | 0+ | Podzem (45 recipes, adapter S); Мир: Живой город goods and recipes (after T-032/T-033); Studio3D custom recipes; public pages for Podzem later [D37E.recipes] |
| A6 → K1.3 | Recipe tree + pinned goal + auto-fill | EMI 4 | none | "all the way to raw" minus what you own, pin up to 3 goals on the HUD, "put in grid" button | M | EVT | 0+ | Мир production chains (Живой город P3); Podzem; Studio3D [D37E.recipes] |
| A7 → K1.3 | Recipe chooser | Polymorph 6 | first match wins | small chooser when 2+ recipes share a grid | S | EVT | 0+ | Podzem; Мир goods [D37E.recipes] |
| A8 → K1.4 | Inventory gestures and crafting buttons | Mouse Tweaks 10, Inventory Essentials 3, Crafting Tweaks 4, TrashSlot 5 | `quickMove`, `spreadEven`, `collect`, `sort` exist | audit, then add the missing: number-key swap, wheel move, rotate/balance/clear/refill-last buttons, trash slot with one-step undo; pad and touch equivalents | S–M | HUD | 0+ | Podzem (has most: share the audit table); Мир inventory and wardrobe; one gesture spec for all inventories [D37E.sheet] |
| A9 → K1.2 | One search matcher | Searchables 6 | none | Cyrillic-friendly prefix/infix/synonym matcher used by inventory, recipes, catalog, key search | S | HUD | 0+ | all lists: site search, games catalog, Podzem, Мир, Studio3D (Проводник, Набор) [D37E.search] |
| A10 → K1.4 | Auto-tool | Best Pick 1 | none in Kubomir | pick best tool while digging, switch back after; default on for touch | S | EVT | 0+ | Podzem has Shift auto-tool (unify the rule); Мир job tools (miner, lumberjack) |
| A11 → K1.6/K1.7 | Minimap + full map | JourneyMap 7, Xaero 2+2, Antique Atlas 1 | none | explored-only tiles (top colour + height shading), north-up or rotating, fullscreen pan/zoom, tiles cached in IndexedDB with LRU | M+M | HUD + WRK | 0+ | Мир phone map and HUD minimap (WORLD_MAP.md); Podzem cave map from explored cells; Studio3D map HUD option; Arena radar [D37E.mapkit] |
| A12 → K1.6 | Waypoints + compass bar | JourneyMap 7 | none | named points (24 emoji, 8 colours, max 64), auto points (death, bed, camp), compass strip at the top, optional beacon sprite | M | HUD | 0+ | Мир waypoints and quest markers on the phone map; Podzem home/depth markers; Studio3D Waypoint part [D37E.mapkit] |
| A13 → K1.7 | Death point + grave | Death Compass 1, Tombstone 3, Grave Danger 2 | text arrow, items stay 5 min | grave block keeps the drop 30-60 min, owner-first 5 min in co-op, map point and arrow, auto-removed on pickup | M | EVT | 0+ | Podzem death marker (items already stay); Мир battle-zone loot on knockout; Studio3D survival respawn point |
| A14 → K1.9 | Finder compass | Nature's Compass 7, Explorer's 3, Structures' 1 | none | pick a biome (structures later) → arrow + map marker; worker spiral search over the pure seeded generator | M | WRK | 0+ | Podzem ore/biome finder by depth; Мир find a place or friend (📍 К другу exists); Studio3D Compass part [D37E.finder] |
| A15 → K1.7 | Biome titles | Traveler's Titles 1 | none | one-line title on entering, once per biome per 5 min, respects reduced motion | S | HUD | 0+ | Podzem biome titles; Мир zone titles (столица, города, боевая зона); Studio3D Region part title [D37E.mapkit] |
| A16 → K1.8 | Camps (waystone-like) | Waystones 5, Wraith 2, Travel Anchors 2 | none | «Привал»: activate, name, list by distance, cooldown, small food cost beyond range, safe landing, shares the waypoint store | M | EVT | 0+ | Мир hub, metro and port teleports (WORLD_MAP stage b); Studio3D Teleporter part; Podzem home/shrine recall [D37E.travel] |
| A17 → K1.5 | Beds, sleeping bag, night skip | Comforts 7, Morpheus 2, Bed Benefits 1 | `meta.bed` is read on respawn but never set; no sleep | bed sets spawn; sleep at night with no hostiles near; skip to morning; sleeping bag = one-night spawn; co-op: share of sleepers decides | S–M | EVT | 0+ | Podzem bed (share night-skip rules); Мир Живой город flats (Выспался buff); Studio3D Bed part and sleep event [D37E.sleep] |
| A18 → K1.5 | Buckets | vanilla staple | water/lava with `V.liquidHeight` | pick and place a full source; milk later; follows the water model T-044 leaves | S–M | EVT | 0+ | Podzem (liquids exist: bucket item); Мир fire-brigade water tool (RP); others no |
| A19 → K1.5 | Lift | OpenBlocks Elevator 6 | none | jump up, crouch down within 32 blocks, same dye colour later, no fall damage | S | EVT | 0+ | Мир skyscraper lifts (reuse the lift rule of interior.js); Studio3D Lift part; Podzem elevator block |
| A20 → K1.5 | Light-ward lamp + light overlay | More Overlays 2, Torchmaster-type 2 | torches | lamp stops hostile spawns in radius 24; overlay marks spawn-safe cells (teaches lighting) | S–M | INST | 0+ | Podzem torch/spawn-light rule plus dark-tiles overlay; Studio3D Spawn-blocker part; Мир no |
| A21 → K1.11 | Backpack | Sophisticated Backpacks 5, Tool Belt 2 | chest only; slot is `{id,n,d}` | portable chest item, tiers 18/36/54, upgrade slots (magnet, auto-eat, sort, filter), no nesting, 💎 skins only | M | EVT | 0+ | Мир job satchel / wardrobe back slot; Podzem bag; Studio3D inventory API; Horde/TD no |
| A22 → K1.15 | Chest finder | FindMe 5 | none | search an item → nearby chests with distance, arrow and instanced outline | M | INST | 0+ | Podzem (📦 quick-stack exists: add find); Мир city lockers search (Живой город) |
| A23 | Chest tiers and drawer wall | Iron Chests 4, Storage Drawers 3 | one chest (27) | wood/iron/gold tiers (art by code), drawer wall with big stacks | M | EVT | 0+ | Podzem chest tiers; Мир city warehouses; Studio3D Storage part |
| A24 | Storage network | Refined Storage 4, AE2 8, Ender Storage 3 | none | cables link chests, one search UI; later request-and-craft; colour-coded ender chests (team chest in co-op) | L | EVT | 0+ | Мир Живой город warehouses and logistics (P3); Podzem no |
| A25 | Carry and radial wheel | Carry On 3, Tool Belt 2 | none | pick up a chest or small animal as an item; radial quick-select for pad and phone | S–M | HUD | 0+ | all games with hotbars: one radial wheel in the input module (Podzem, Мир, Studio3D); carry idea for Мир props |
| A26 → K1.12 | Key search + conflicts | Controlling 8 | `ACTS` with 2 keys per action | search by action/key, conflicts filter, reverse "press a key", reset one | S | HUD | 0+ | all games through the shared D37Settings Controls tab |
| A27 → K1.12 | Notification center | Toast Control 7 | achievement pop, tips | categories, duration, quiet mode, history of 30 | S | HUD | 0+ | all games and the site: one notification centre [D37E.notify] |
| A28 → K1.13 | Smart mining | FTB Ultimine 5, Ore Excavation 1, Log Begone 4, Fast Leaf Decay 2, Hammers 1 | `fellTree` | toggle "vein/tree": BFS up to 64 with caps, durability and food cost, off in hardcore; leaves vanish fast after logs | S–M | EVT | 0+ | Podzem vein/tree mining (2D BFS); Мир Живой город miner/lumberjack batch jobs [D37E.veins] |
| A29 | Build wand, copy/paste | Building Gadgets 5, Construction Wand 3 | importer + `VR.preview` ghost | place a row/plane in one tap; copy, paste, mirror with ghost and an undo journal | M | EVT | 0+ | Studio3D (has copy/paste and arrays: merge ghost + undo journal); Мир plot building (mir-base); Podzem area fill |
| A30 | Decor variants station | Chipped 6, Rechiseled 3, Macaw's 5-6, FramedBlocks 4 | no slabs/stairs/panes | one carving table turns a block into slab/stair/wall/fence/pane/trapdoor/camouflage; shapes generated from material sets; 16 dye colours in the state nibble | L | INST | 0+ | Studio3D Набор variants; Мир plot decor styles; Podzem tile variants |
| A31 | Furniture and pads | MrCrayfish 5, Handcrafted 5, Dark Utilities 6 | `bouncer` block | sit, store, speed and jump pads | M | EVT | 0+ | Мир house furniture (FURN) and obby pads; Studio3D SpeedPad/Jump parts exist; Podzem platforms |

### B. Visuals, animation, audio
| ID | Idea | Seen in | Now | Our version | Cost | Budget | Age | Где ещё |
|---|---|---|---|---|---|---|---|---|
| B1 | Connected glass, then bookshelves | CTM 6, Fusion 5, Connected Glass 3 | plain glass | blob tile set (up to 47 variants drawn by code) chosen from the 8-neighbour mask in the mesher | M | GFX | 0+ | Мир building glass; Studio3D material option 'connected'; Podzem autotile edges (same blob-set tool) |
| B2 | Mob rig animation | Fresh Animations 3, NEA 4, EMF/ETF 3 | box mobs with bob | data rig: bone boxes + channels idle/walk/attack/hurt/death; at most 6 draw calls per mob; instancing by type | L | WRK + GFX | 6+ | Podzem: 2D sprites baked from the same rigs (char2d method, docs/MOBS.md); Мир animals and NPC; Studio3D creature parts; Horde enemies [D37E.bestiary] |
| B3 | Held light as world light | Dynamic Lights 1 | entity lamps near, held torch lights entities | 1-2 world light sources from held torches on pretty/ultra | S–M | GFX | 0+ | Мир night-city flashlight; Studio3D light on character; Podzem has dynamic light |
| B4 | Cave reverb and muffling | Sound Physics 2 | surface footsteps | 6 rays at 4 Hz → convolver/low-pass by enclosure; off on low | S–M | WRK | 0+ | Podzem cave reverb (2D rays); Мир interior.js rooms; Studio3D reverb zones |
| B5 → K1.12 | Per-category volume | Extreme Sound Muffler 4 | master + a few | sliders: steps, mobs, weather, music, UI | S | HUD | 0+ | all games via D37Settings |
| B6 | Aurora, season leaves | Auroras 1, Falling Leaves 1, Visuality 1 | leaves near player, fireflies | aurora ribbons on cold-biome nights (sky shader), leaf density by season | S–M | GFX | 0+ | Мир sky and aurora via climate.js; Studio3D weather panel; Podzem surface sky (shade2d) |
| B7 | Loot beams and labels | LootBeams 1 | bobbing items | thin beam (instanced) for rare drops, name label when looked at | S | INST | 0+ | Podzem item drops; Мир battle-zone loot; Horde gems/chests; Studio3D Collectible part effect |
| B8 | Traversal toys | Paragliders 1, Elytra Slot 4, Combat Roll 2 | parkour, ledge grab | glider with stamina, grapple hook, roll (with T-041) | M | EVT | 0+ | Podzem grapple exists (share module); Мир glider/grapple for the battle zone; Studio3D movement tool parts |
| B9 | Look slots + trims | Cosmetic Armor 5, Immersive Armors 4, Dynamic Trim 3 | no armor | armor sets, separate look slot, palette trims; 💎 skins cosmetic only | M | GFX | 6+ | Мир wardrobe layers (look vs stats); Podzem hero sprites; Studio3D character appearance |
| B10 | Photo mode | Exposure Catalog 1 | none | hide HUD, free camera within 8 blocks, filters, share link (traffic) | S–M | HUD | 0+ | Мир photo mode; Studio3D photo mode; Podzem screenshot without HUD (share link) |
| B11 | Loading screens with tips | Drippy 3 | loading exists | tips plus the existing `D37AdPlaces.loading` slot | S | HUD | 0+ | all games (D37AdPlaces.loading): one tip pool per game |
| B12 | VHS pack for horror mode | Insanity Shader 3 | five packs | sixth pack, horror mode only | S | GFX | 12+ | Podzem shade2d CRT/VHS variant; Studio3D shader preset; Мир no (kids) |

### C. Content
| ID | Idea | Seen in | Now | Our version | Cost | Budget | Age | Где ещё |
|---|---|---|---|---|---|---|---|---|
| C1 | Mob rig + AI verbs + spawn rules (JSON) | Alex's Mobs 4, In Control! 4, Creeper Overhaul 3 | 5 box mobs, difficulty table | JSON mob: boxes, channels, stats, drops, verbs (wander, flee, follow, melee, ranged, burrow, fly, swim, climb), spawn rule {biomes, time, light, depth, weight, group, max}; biome variants by recolour plus one trait | L | WRK + EVT | 6+ | Podzem (7 mobs, 2 bosses: same JSON, 2D sprites baked); Мир animals and zone mobs; Studio3D creature parts + spawn rules without code; Horde waves [D37E.bestiary] |
| C2 | Elites with one affix | Champions 2, Infernal 1, Special Mobs 1 | none | 5 affixes (fast, spiky, healer, shielded, splitting), name above the mob, better drop, scale with stage | S–M | EVT | 6+ | Podzem; Horde elites; Studio3D NPC affix property |
| C3 | Boss framework with telegraphs | BoMD 2, Progressive 1, Brutal 1 | none | phases, ground-warning decals (instanced), arena lock, knockout not death; the 4 bosses of `docs/MOBS.md` | L | GFX + EVT | 6+ | Podzem (more bosses); Horde (5:00 and 9:00 bosses: telegraph decals); Мир battle-zone event; Studio3D Boss preset in Режим игры |
| C4 | Pets and mounts | Mythic Mounts 2, Dragon Mounts 1, Mob Lassos 1 | none | tame dog/cat/parrot with food; horse with saddle; hatchlings later | M | EVT | 6+ | Мир pets (kids town); Podzem pets; Studio3D companion NPC (follow exists); Horde pet |
| C5 | Structures grammar + loot tables | WDA 5, Dungeon Crawl 3, Dungeons Enhanced 2, YUNG 2, Yeetus 4 | none | seeded jigsaw with connectors, 8 types (camp, ruined tower, mineshaft, dungeon, biome temple, hut cluster, boss lair, sky ruin); worker at most 1.5 ms per chunk; per-player chests | L | WRK | 6+ | Podzem 2D dungeons and temples; Мир interior.js and districts (same grammar core); Studio3D generate-dungeon for authors; TD/Horde procedural maps [D37E.structures + D37E.loot] |
| C6 | Villages and traders | Towns and Towers 4, Goblin Traders 1, Custom Trades 1, Trade Cycling 3 | none | village generator, 4 NPC jobs, trades as data (`trades[]`), wandering trader, price preview | L | EVT | 6+ | Мир Живой город market and traders; Podzem Проводник/trader NPC; Studio3D Trader NPC with trades |
| C7 | Biomes genVer 3 | BoP 5, Regions Unexplored 3, OTBWG 2, Tectonic 1 | 10 biomes | +6 (spring grove, savanna with baobab, badlands strata, tundra, glow/mushroom caves, coral coast), taller mountains and canyons; new worlds only | L | WRK | 0+ | Podzem (4 biomes, shared biome catalog); Мир worldmap.js biome set; Studio3D terrain materials [D37E.biomes] |
| C8 | Underground variety | Deeper and Darker 2 | caves, ravines | lush caves, crystal caves (boss lair), dripstone, a deep layer with a "keep quiet" rule | M | WRK | 6+ | Podzem cave biomes (mushroom, crystal); Мир metro/mine interiors; Studio3D |
| C9 | Farming core | Farmer's Delight 5, Farming for Blockheads 5, RightClickHarvest 2, Bone Meal 2, Serene Seasons 2 | no hoe or crops | hoe, tilled soil, 8 crops, growth by a random-tick budget in loaded chunks (3 per 16x16x16 section per second), light + water + season (T-001) + frost, bone meal, right-click harvest and replant | L | EVT | 0+ | Мир Живой город farmer (growth formula shared); Podzem crops and herbs; Studio3D Crop part |
| C10 | Cooking | Farmer's Delight 5, Spice of Life 2, Cooking for Blockheads 4 | furnace cooks meat | cooking pot: 3-ingredient meals with comfort buffs (warm, regen), variety bonus | M | EVT | 0+ | Мир Живой город cook (meal-buff table); Podzem cooking station; Studio3D |
| C11 | Fishing | Aquaculture 4 | none | rod + timing minigame (tap or button), 12 fish by biome and time | S–M | EVT | 0+ | Мир park pond fishing; Podzem fishing (bait/lure art exists); Studio3D Fishing part |
| C12 | Animal breeding | Productive Bees 3, vanilla | herd animals only | feed two → baby, milk bucket, eggs; bees optional | M | EVT | 0+ | Мир kids farm animals and pets; Studio3D |
| C13 | Armor and trims | Immersive Armors 4, Dynamic Trim 3 | none | 4 tiers, armor value into `D37E.combat`, look slot (B9) | M | EVT | 6+ | Podzem armor over char2d sprites; Мир battle-zone gear; Studio3D Accessory parts; Horde equipment |
| C14 | World presets | StoneBlock start (SB3), Void (CRAFT 1) | normal only | Normal, Island, StoneBlock (all stone), Sky islands, Flat, Archipelago; shareable seed link | S–M | WRK | 0+ | Podzem world presets; Studio3D templates (площадка, обби, остров) get seed links; TD maps |
| C15 | Bounty board | bounty chapters in ATM10, DRK1, DRK2 | none | board at spawn/villages, 3 local jobs per day from (seed, day), in-world rewards only, no penalty | S–M | EVT | 0+ | Мир Живой город job board (same board data); Podzem Проводник daily tasks; Studio3D Board part; site weekly quests (T-015) stay server-side |
| C16 | Encyclopedia + bestiary | Patchouli 6, Modonomicon 4, Completionist 2 | none | entries unlock on discovery; search; same sheet kit; mods add entries; `docs/MOBS.md` bestiary | M | HUD | 0+ | Podzem, Мир, Horde/TD enemy cards, site SEO pages (/bestiary) [D37E.bestiary] |

### D. Systems
| ID | Idea | Seen in | Now | Our version | Cost | Budget | Age | Где ещё |
|---|---|---|---|---|---|---|---|---|
| D1 → K1.10 | Quest book | FTB Quests 7, Better Advancements 5 | 18 achievements + tip chain | chapters, tasks, rewards, pin; phone list, PC graph; achievements become its first chapter (same ids so the server claim `kb:<id>` is unchanged) | M–L | EVT | 0+ | Podzem (GOALS become chapters); Мир Живой город tasks + site daily/weekly quests (server rewards); Studio3D Quest part (no-code chains); Horde/TD achievements as a chapter [D37E.quests] |
| D2 → K1.10 (minimal), P3 (full) | Ages with unlock gating | SevTech stages (SEV), Game/Item/Recipe/Mob Stages | none | 7 ages (Wood, Stone, Fire, Iron, Deep, Machines, Sky) as chapters with `unlock` lists; locked recipes show 🔒 and a hint; per player; world rule «Помощники: сразу / открывать» | M | EVT | 0+ | Podzem tiers; Мир Живой город phases and Universe eras; Studio3D stage gating in modes [D37E.quests] |
| D3 | Skill path | Pufferfish 2+2, Passive Tree 1, PRM2 talents | none | per-world skills (Mining, Fighting, Building, Exploring, Farming) × 3 perks, a point per level; PC graph, phone list; no link to site XP | M–L | EVT | 6+ | Мир Живой город skills (already planned); Podzem perks; Horde upgrades; Studio3D skills no-code [D37E.skills] |
| D4 | Modular tools | Tinkers 3, Silent Gear 2 | fixed tools | parts (head/handle/binding) + material traits; builder with live stat preview; mods add materials | L | EVT | 6+ | Podzem tools from parts; Studio3D tool builder; Мир job tool tiers |
| D5 | Rarity + deterministic upgrade | Apotheosis 3, Tierify 2 | none | rarity colours from drops only; a forge station raises tier deterministically; pity rule; nothing bought | M | EVT | 6+ | Podzem loot rarity; Horde weapon evolutions (align); Мир battle-zone weapons |
| D6 | Trinket slots | Curios 5, Artifacts 5, Relics 3 | none | 3 slots (ring, charm, back) filled from dungeons | M | EVT | 6+ | Podzem accessory slots; Мир wardrobe trinkets (cosmetic); Studio3D |
| D7 | Mechanical power | Create 2 | none | shafts, gears, wheel/windmill/hand crank; grinder, saw, press, drill, deployer, belt; graph solver on change; rotation by shader uniform (0 CPU per frame); contraptions on Rapier | L | EVT + GFX | 6+ | Studio3D (best fit: gear/motor/belt parts on Rapier joints); Мир factories (Живой город P3); Podzem wires later |
| D8 | Machines and pipes | Mekanism 6, IF 6, Pipez 4, Powah 4, IE 4 | furnace | 3x3x3 pattern-matched stations, item pipes, tiered generators; skip chemistry | L | EVT | 6+ | Мир Живой город factories; Studio3D machine parts |
| D9 | Spell crafting | Ars Nouveau 4, Iron's 3, Botania 3, Wizards 2 | none | spellbook with 3 slots (shape + element + modifier), mana from rest and crystals, 12 parts, no gore | L | EVT + GFX | 6+ | Podzem wand/magic weapons; Horde weapon evolutions; Studio3D Spell tool; Мир no |
| D10 | Programmable bot | CC: Tweaked 5 | mod sandbox exists | educational "Prog-bot" on the Lua/JS sandbox (move, dig, place, look) | L | WRK | 6+ | Studio3D (scripts exist: Prog-bot is a part with a tiny API); Мир NPC scripts; mods only elsewhere |
| D11 → K1.0 | Recipe edits and tags in data | CraftTweaker 2, KubeJS 6 | mods only add | `remove/replace`, `tags`, `unlock` in `mod.json` (api 1, additive) | S | EVT | n/a | docs/MODS.md shared format already covers Podzem and Kubomir; Studio3D scripts |
| D12 | Mob scaling by stage | Mob Stages 1, Progressive Bosses 1, PRM2 | difficulty table | scale within bounds by player stage and party size | S–M | EVT | 6+ | Horde time scaling exists (align); Podzem boss scaling; Мир battle zone |

### E. Dimensions and space (see §6.4 for the Universe link)
| ID | Idea | Seen in | Now | Our version | Cost | Budget | Age | Где ещё |
|---|---|---|---|---|---|---|---|---|
| E1 | Multi-dimension world format | all dimension mods | one overworld | `meta.dims[id] = {seed, profile, spawn}`; chunks keyed by (dim, cx, cz); per-dim time/weather; portal registry; one generator profile contract | L | WRK | 0+ | Podzem layers/worlds via portals; Мир regions (mir-region-N); Studio3D multi-place worlds; Universe places |
| E2 | Portal frames after progress | AoA 1, Twilight Forest 3, RFTools Dim 1 | none | frame crafted after a chapter; lit with a key item; a safe return portal | M | EVT | 6+ | Мир hub portals; Studio3D Portal part; Podzem |
| E3 | Themed dimensions | Undergarden 3, Eternal Starlight 2, Blue Skies 2 | none | «Огненные недра» (lava seas, basalt), «Небесные острова», «Ледяной мир»; own mobs, boss, ore | L each | WRK | 6+ | Podzem (sky, hell); Studio3D templates |
| E4 | Pocket room | Hyperbox 3, Compact Machines 2, Personal Space 1 | none | item opens a private 16x16x16 room at far coordinates; invite friends; safe base for kids | M | WRK | 0+ | Мир plot/house as pocket space; Studio3D My-home template; Podzem house |
| E5 | Rockets and oxygen | Beyond Earth (DDSS2), Ad Astra (PRM2), ExtraPlanets/Galacticraft (SEV) | none | tier 1 Moon (jump x2.5, no air), tier 2 Mars, tier 3 Venus; fuel, pad, countdown (loading screen = ad slot); suit with oxygen tank or sealed rooms with an oxygen block; unique ores | L | EVT + WRK | 6+ | Мир spaceport (Universe step 7, air vehicle module); Studio3D Rocket part |
| E6 | Planet profile | RFTools Dim, Ad Astra planets | n/a | JSON contract (§6.4) shared with Universe step 7 | M | n/a | n/a | Universe step 7; Studio3D planet presets in world settings [D37E.planet] |
| E7 | Mining dimension | Allthemodium 2 | none | resource trip world: rich ores, harder mobs, resets monthly | M | WRK | 6+ | Мир Живой город quarry; Podzem deep mining |

### F. Horror (opt-in, age-gated)
| ID | Idea | Seen in | Now | Our version | Cost | Budget | Age | Где ещё |
|---|---|---|---|---|---|---|---|---|
| F1 | World mode «Тёмные ночи» | CHP, EH | none | world rule, labelled 12+ (16+ for strong effects), off by default; sanity meter (dark → vignette, whispers); one-tap «Свет» turns it all off | M | HUD + GFX | 12+/16+ | Studio3D horror mode preset (12+); Podzem dark caves (12+); Мир and kids games never |
| F2 | The watched creature | Weeping Angels (idea only) | none | freezes when looked at, creeps when not; ends in a soft knockout | S–M | EVT | 12+ | Studio3D NPC property freeze-when-watched; Podzem |
| F3 | Cave stalker with sound cues | Cave Dweller 1, Eyes in the Darkness 1 | none | light-dependent, nearer = louder, dissolves in torch light (the «Тень» of MOBS.md) | M | EVT | 12+ | Podzem (the Тень of MOBS.md); Studio3D |
| F4 | Fog stalker | Man From The Fog 1 | weather exists | appears in thick fog (with T-023) | S | EVT | 12+ | Studio3D (with climate fog); Мир no |
| F5 | Pumpkin night | Spooky Trees 1 | event idea in MOBS.md | seasonal event with decor rewards, cartoon | S–M | GFX | 6+ | Мир (Тыквенная ночь already in celebrate.js: reuse); Podzem; Studio3D holiday decor |
| F6 | Safety switch | — | — | «Свет»: replaces scary mobs with silly ones, removes sanity effects | S | HUD | all | every horror-labelled mode in any game |

### G. Multiplayer (depends on T-019 host model)
| ID | Idea | Seen in | Our version | Cost | Age | Где ещё |
|---|---|---|---|---|---|---|
| G1 | Party + shared quest progress + team chest | FTB Teams 7, SOLO parties | team list kept by the host; shared chapter progress; colour-coded team chest | M | 6+ | Мир friends and party invites; Horde/TD coop; Studio3D teams (exist); Podzem coop plan |
| G2 | Claims | FTB Chunks 6 | «Флаг» block claims 3x3 chunks; map overlay; N free; PvP off by default | M | 6+ | Мир plots are claims already; Studio3D region ownership; Podzem coop |
| G3 | Roles | FTB Ranks 5 | owner / member / guest checkboxes (build, break, chests, PvP) | S–M | 6+ | Мир communities roles (chat) as a model; Studio3D host permissions; Podzem coop |
| G4 | Per-player loot | Lootr 4 | each player rolls own chest loot, stored by player id on the host | S–M | 6+ | Podzem coop; Studio3D Chest part option; Мир battle-zone crates |
| G5 | Proximity voice | Simple Voice Chat 2 | reuse `calls.js` with TURN from T-045; push-to-talk; off under 13 | M | 13+ | Мир near-player voice (phone calls exist); Studio3D worlds; Horde coop |
| G6 | Home/back conveniences | FTB Essentials 5 | covered by beds, camps, compass; add "back" after a teleport | S | 0+ | Мир (📍 К другу exists); Studio3D |

### H. Engine and performance
| ID | Idea | Seen in | Now | Our version | Cost | Где ещё |
|---|---|---|---|---|---|---|
| H1 → K1.0 | Recipe index | FastWorkbench 4, FastFurnace 3 | linear scan `for (const r of V.recipes)` | shape-hash Map + ingredient index (same index feeds A5) | S | Podzem recipe lookups; Studio3D custom crafting [D37E.recipes] |
| H2 | Cave culling | Sodium 4, Embeddium 3 | greedy meshing, frustum | chunk connectivity graph to skip hidden chunks underground; measure draw calls in caves | M–L | Podzem 2D light/chunk culling; Мир interior occlusion; Studio3D large worlds |
| H3 | Entity culling + AI budget | Entity Culling 7, AI Improvements 5, Lithium 2, Let Me Despawn 2 | mobs near the hero | skip hidden mobs; AI only within 48 blocks, staggered by id; spatial hash | M | Мир residents; Horde hundreds of enemies; Studio3D NPC; Podzem mobs |
| H4 | Item merge | Clumps 9 | magnet radius 2.6 | merge same-stack item entities within 1 block; cap 64 loose | S | Podzem drops; Horde gems; Studio3D Collectibles |
| H5 | Failure isolation | Neruina 3 | soft fallbacks in places | wrap mob/feature update in try/catch, remove the culprit, `d37Err('where', e)` without player data | S | all games: one D37E.guard wrapper |
| H6 | Profiler | spark 6 | F3 | per-system ms table in F3 and JSON export for agents | S | all games: shared F3 / D37E.perf table |
| H7 | Lazy init and memory | ModernFix 7, FerriteCore 7 | atlases, caches | release unused atlases, dedupe geometry per block state, lazy sheet kits | S–M | all games: lazy init and disposal rules |
| H8 | Tags and unification | Almost Unified 3 | `#planks` only | general `tags` so mods unify copper/silver and do not flood lists | S | all data catalogs and mod formats (tags) |
| H9 → K1.6 | Map tile as mesher by-product | (map mods) | mesh worker | emit top-colour tile per chunk with no second pass | S | Podzem chunk worker to minimap tiles; Мир worldmap tiles [D37E.mapkit] |

---

## 3. Roadmap

### 3.1 Phases
| Phase | Theme | Items | Waits for | Board link | Agent runs (estimate) |
|---|---|---|---|---|---|
| 1 «Удобнее» | helpers that remove friction | K1.0-K1.15 (§4) | T-019 (co-op, cloud saves: per-player state), T-044 (water: buckets), T-043 for K1.12 only | new tasks; K1.0 starts right after T-019 and T-044 merge | about 15 |
| 2 «Содержимое» | reasons to explore and a survival loop | C1-C16, B1-B12, A23/A25/A30, D12 | Phase 1 K1.0; art with T-021; mobs with T-020; weather jokes with T-023 | T-020 (C1-C4, F-group), T-021 (B1, A30 art), new: farming, structures, biomes, presets, bounty board, bestiary | about 22 |
| 3 «Системы» | depth for veterans | D2-D10, A24, A29, A31, G1-G5, E4 | Phase 2 (mobs, structures), T-019 host model, T-045 for voice | new tasks; T-022 (physics: support, fire) interlocks with D7 | about 20 |
| 4 «Миры и космос» | dimensions, rockets | E1-E3, E5-E7, F-group full | Phase 3 skills/loot; Universe step 7 contract | Universe T-014 steps; new tasks | about 12 |

### 3.2 Running work this plan must not break
| Task | What it touches | Our rule |
|---|---|---|
| T-019 co-op + cloud saves | `kubomir.js` meta/save, `voxel-store.js`, net | wait for the merge; store per-player state in `P.ext` (§5.1) so host sync can partition it |
| T-044 water | `voxel-render.js`, `voxel-mesh.js`, water shader | buckets (K1.5) start after the merge and follow its water model |
| T-042 engine controls | `controls.js`, `camera.js`, `V.moveBox` | no edits to those files in Phase 1 |
| T-043 one menu, settings window | `settings.js`, `gfx-settings.js`, menus | settings rows go through `D37Settings.addTab('kubomir')` only; K1.12 waits |
| T-020 mobs/bosses/nights, T-021 art, T-022 physics, T-023 weather | ents, textures, support/fire | Phase 2 items C1-C4 join T-020 (one mob format); B1/A30 art with T-021; fire interacts with ward lamp and torches |

### 3.3 Shared modules (owner 22.10: build once, use in several games)
Rule: every idea is built once as an engine module (`js/engine/`, namespace `D37E.*`) or a shared data catalog, with a thin adapter per game. Kubomir is the first adapter and the test bed; the second adapter is a small separate task (S–M) right after. The «Где ещё» column in §2 says where each idea lands.

| Module | Holds | First adapter → next adapters |
|---|---|---|
| `D37E.host` + `D37E.sheet` | feature host (register, emit, `ext`), sheets (bottom sheet / dock, virtual list, pad focus) | Kubomir (K1.0) → Podzem, Мир phone apps, Studio3D |
| `D37E.recipes` + `D37E.search` | recipe and source index, search matcher, tree calculator, favorites, pinned goals | Kubomir (K1.2-K1.3) → Podzem (S), Мир goods (after T-032/T-033), Studio3D custom recipes, public pages |
| `D37E.info` | provider registry, target card, hover cards | Kubomir (K1.1) → Podzem, Мир prompts, Studio3D `info` property, Horde/TD cards |
| `D37E.quests` | chapter / quest / task / reward format, validator (no coins or XP), event engine, sheet; reward backend per game | Kubomir (K1.10) → Podzem GOALS, Мир (site daily and weekly quests, server rewards), Studio3D Quest part, Horde/TD achievements |
| `D37E.mapkit` | tile store (IndexedDB, LRU), minimap and fullscreen renderers, waypoint store, compass bar, name filter | Kubomir (K1.6-K1.7) → Мир phone map (WORLD_MAP), Podzem cave map, Studio3D map HUD |
| `D37E.travel` + `D37E.finder` | named teleport list with cost rules as data; time-sliced search over a pure `biomeAt/structureAt` | Kubomir (K1.8-K1.9) → Мир hub/metro/ports, Studio3D Teleporter and Compass parts, Podzem |
| `D37E.bestiary` | mob rig + AI verbs + spawn rules (JSON), encyclopedia, 2D sprite baking from the same rig | Kubomir (C1, T-020) → Podzem (docs/MOBS.md), Studio3D creature parts, Horde/TD cards, public /bestiary pages |
| `D37E.loot` + `D37E.structures` | weighted tables, per-player rolls, seeded jigsaw grammar | Kubomir (C5) → Podzem 2D pieces, Мир interior.js (same grammar core), Studio3D generate-dungeon |
| `D37E.skills` | skill and perk tree as data, XP from events | Kubomir (D3) → Мир Живой город skills, Podzem, Horde upgrades, Studio3D |
| `D37E.sleep`, `D37E.veins` | night-skip rules (is-night callback, hostiles check, share of sleepers); BFS mining with caps | Kubomir (K1.5, K1.13) → Podzem beds and 2D veins, Мир flats |
| `D37E.biomes`, `D37E.planet` | shared biome catalog with pure `biomeAt`; PlanetProfile contract (§6.4) | Kubomir, Podzem, Мир worldmap; Universe step 7 |
| `D37E.notify`, `D37E.guard`, D37Settings Controls search | notification centre, failure isolation, key search | shared by design from the start |

Rules: (1) engine files from day one, tests run against a mock adapter and the Kubomir adapter; (2) each module header documents its adapter interface (5-10 methods); (3) no per-game forks: variations are data; (4) shared design adds about 15-25 % to the first implementation and brings each next game down to S–M; (5) second adapters respect file ownership: Podzem files are free (T-006 done), Мир files are busy with T-032 and T-029, Studio3D files are free; all go through the seam; (6) Studio3D receives these as no-code parts (Quest, Waypoint, Teleporter, Lift, Spawn-blocker, Trader, Board, Info label, Compass), not as scripts only; (7) public pages and SEO use the same catalogs (Kubomir recipes K1.14, then Podzem recipes, then /bestiary).

Second-adapter order (after Phase 1 wave 3): 1. `quests` → Мир (site quests, strongest retention) and Podzem; 2. `recipes` → Podzem (S); 3. `bestiary` → Podzem together with T-020; 4. `mapkit` → Мир phone map after T-029; 5. `info` → Podzem; 6. one batch of Studio3D parts (Quest, Waypoint, Teleporter, Lift, Info, Trader, Board).

### 3.4 Phase 1 waves (4 lanes at most, disjoint files)
- **Wave 0**: K1.0 alone (seam, events, `P.ext`, sheet kit, index skeleton, block ids appended in one commit, test harness, perf protocol).
- **Wave 1 (parallel)**: lane A K1.1 (info pack, `kubomir-info.js`); lane B K1.2 then K1.3 (recipes, `kubomir-recipes.js`, `kubomir-ui.js` hook); lane C K1.5 (world helpers: `voxel.js` block/item definitions already stubbed, `voxel-tex.js` painters, use handlers); lane D K1.6 then K1.7, K1.8, K1.9 (map family: `kubomir-map.js`, `kubomir-camp.js`, `kubomir-finder.js`, small mesher by-product).
- **Wave 2**: K1.4 (inventory comfort, after K1.3 because both edit `kubomir-ui.js`), K1.10 (quest book, after K1.1), K1.11 (backpack, after K1.4).
- **Wave 3**: K1.12 (after T-043), K1.13, K1.14 (after K1.2), K1.15 (after K1.2).
- Each agent: commits per step, GAMES_VER above both merged branches, one numbers report (before/after) in the final message, no edits in a file owned by another lane.

### 3.5 Phase 2 order (value for retention and traffic ÷ cost)
1. C9 + C10 + C11 farming, cooking, fishing (the survival loop; seasons already exist). 2. C1 + C2 mob format, spawn rules, elites (with T-020). 3. C5 structures + loot tables + G4 per-player loot. 4. C7 + C8 biomes and caves (genVer 3, new worlds only). 5. A30 + B1 decor variants and connected glass (with T-021). 6. C3 bosses (four from MOBS.md). 7. C14 world presets and B10 photo mode with share links (traffic). 8. C4 pets and mounts, B8 traversal toys, C13 armor. 9. C16 encyclopedia, C15 bounty board, C6 villages. 10. F1-F6 horror pack (opt-in), B12.

### 3.6 Phase 3 order
D7 mechanical power (the headline system), D4 modular tools, D3 skill path, D9 spells, D2 full ages, A24 storage network, A29 build wand, D5/D6 loot and trinkets, G1-G5, E4 pocket room, D10 bot, A31 furniture.

### 3.7 Phase 4 order
E1 multi-dimension format first (everything else needs it), E2 portals, E3 one dimension at a time («Небесные острова» first: cheapest generator), E5 rockets to the Moon, then Mars and Venus, E7 mining dimension; E6 contract frozen with the Universe team before E5 starts.

### 3.8 Not doing (and why)
Blood Magic, Occultism, vampire/werewolf themes (violence/occult, red line); SCP, Rake, Herobrine, Weeping Angels as named things (third-party IP; generic mechanic only); Mekanism-style chemistry and PneumaticCraft pressure (too abstract for 6+); Chisels & Bits (sub-block voxels break physics and phones); FancyMenu (menus are ours); Chance Cubes and any randomized paid loot (red line); Mutant monsters (not for 6+); GTNH-style tech depth (not our audience).

---

## 4. Phase 1 specs (implementation-ready)

**Naming (owner 22.10, shared modules).** Below, `KubomirX`, `KubomirSheet`, `KubomirIndex` and the feature names mean the shared engine modules of §3.3 (`D37E.host`, `D37E.sheet`, `D37E.recipes`, `D37E.info`, `D37E.quests`, `D37E.mapkit`, `D37E.travel`, `D37E.finder`, `D37E.sleep`, `D37E.veins`) plus a thin Kubomir adapter file. Write the logic in `js/engine/` from the start, never in `kubomir*.js`; every spec has a «Shared module» line.

Common to every item: new code in new files, loaded through the Kubomir `scripts` list in `js/features/games.js` (bump `GAMES_VER` above both merged branches; bump `sw.js` VERSION if shell files change); the only edits to `kubomir.js` are the marked hooks from §4.0; every feature guards itself with try/catch and disables itself for the session on error (`d37Err('kx:<id>', e)`, no player data in the message); text through `textContent`; strings are Russian, own wording.

### 4.0 K1.0 Plumbing (M, wave 0, one agent, before everything else)
- **Shared module**: the seam is generic: `js/engine/gamekit.js` exposes `D37E.host(adapter)` (register / emit / `ext` / sheets, with `D37E.sheet`); `kubomir-x.js` is only the Kubomir adapter (about 10 hooks). Other games add an adapter later (§3.3). Event names are game-neutral: `break`, `place`, `craft`, `pickup`, `kill`, `eat`, `use`, `sleep`, `biome`, `day`.
- **Why**: `kubomir.js` is 181 KB and every feature wants a hook there. One seam keeps 4 parallel lanes from colliding.
- **Seam** (new `js/games/kubomir-x.js`, loaded right after `kubomir.js`):
  ```js
  const KX = window.KubomirX = {
    register(f){},   // f = { id, order, init(st), dispose(st), update(st, dt), hud(st), on: { break, place, craft, smelt, pickup, kill, eat, use, sleep, wake, knockout, respawn, biome, day, camp, quest } }
    emit(st, type, a, b, c, d){},  // fixed arity, no allocation; fan-out over Map<type, fn[]>; a try/catch per handler
    open(st, sheetId, arg){},      // open a registered sheet
    ext(st){ return st.P.ext || (st.P.ext = {}); }   // per-player namespace, one key per feature id
  };
  ```
  Hooks in `kubomir.js` (about 10 single lines, each inside `// ── KX:<name> ──` markers): `init/dispose` at world start and stop; `update` in the fixed step after the player update; `hud` at the end of `hudUpdate`; `emit` in the break/place paths (`onEdit`), craft-result take, smelt-output take, item pickup, mob kill, eat, `die` (knockout), respawn, biome change (existing 0.25 s sky tick), day rollover; `useBlock(st, hit)` and `useItem(st, slot)` for right-click on custom blocks and items.
- **`P.ext`**: per-player state, namespaced by feature (`ext.map`, `ext.quests`, `ext.camps`, `ext.fav`, `ext.pins`). K1.0 verifies that `metaSnap` writes it (add explicitly if `player` is copied field by field) and adds a save/load round-trip test. Total `P.ext` at most 64 KB; on save, drop history lists first. World-wide state goes to `meta.shared.<feature>`, world rules to `meta.rules`.
- **Block ids**: appends all Phase 1 block ids in one commit with stub definitions hidden from the creative list (`bed`, `lift`, `ward_lamp`, `camp`, `grave`), so lanes never fight over ids (ids are permanent and append-only; the stub keeps `palette` stable).
- **Sheet kit** (`KubomirSheet`): `open({id, title, tabs, search, render(body, ctx), onClose})`; one sheet at a time; same input-blocking path as the inventory (extracted into one helper so both behave alike); touch release on open; focus ring and d-pad/A/B/LB/RB for pad; virtual list helper (at most 24 DOM rows); bottom sheet on phone, right dock on PC (side by side with inventory from 720 px). Styles reuse the existing `.kb-*` look.
- **Index skeleton** (`KubomirIndex.build(V)`): see K1.2.
- **Mod format additions** (`voxel-mods.js`, additive, api stays 1): see §5.4; plus the differential tests.
- **Test harness**: `scripts/kubomir-qol-test.cjs` (shared helpers, mock `st`, event streams, FPS runner) and the perf protocol of §5.5. Add to `TESTS` in `scripts/ci-run.cjs`.
- **Done when**: a sample feature registers, receives events, saves `ext`, opens a sheet; hooks cost at most 0.01 ms per frame with no features; all existing Kubomir tests unchanged (hand-test 271, input 89, move 73, combat 33, voxel 215).

### 4.1 K1.1 Info pack (M, lane A): target card, hover cards, held-item flash, food preview, clock/coords chip
- **Shared module**: `D37E.info` (provider registry, card, hover card) in `js/engine/info.js`; the Kubomir adapter supplies block, mob and item providers; later Podzem tiles and mobs, Мир [E] prompts, Studio3D `info` property, Horde/TD enemy and tower cards.
- **Data**: block lines come from registry fields (`title`, `tool`/`tier`, `hard`, `drop`, `ui`, `liquid`, `emit`) plus optional `info: ["…"]` from mods (at most 4 lines of 80 chars). Mob lines from `MOBS[type]` (`title`, `hp`, hostile or passive, `drops`). Item lines from `V.item(id)` (`tool`, `food`, `fuel`, `places`). Internal record `TargetInfo { kind, name, sub, lines[], canBreak, need, have, progress }` reused (no allocation per frame).
- **Rule that must not drift**: `canBreak` uses the same function as digging, so the card never disagrees with the game; a test compares all blocks × all tools.
- **UI**: PC and pad: card `div.kb-tcard` top-centre under the compass bar, three lines at most (name; tool check green/orange/red + break time; drops as 3 icons), mobs show hearts only after damage or a 0.5 s look; chest shows "📦 12/27"; furnace shows progress and fuel. Phone: slim pill (name + dot), shown on dwell (0.6 s) or toggle, never over the thumbs. Setting «Подсказка под прицелом»: Выкл / Коротко / Подробно (default Коротко on PC and pad, Выкл on phone). Hover card: PC hover 250 ms, phone long-press 400 ms, pad Y; shows name, use, durability bar, source namespace, and «Где взять» (opens K1.2 on that item).
- **Food preview**: while holding food, ghost icons on the hunger bar for `min(hunger, 20 − P.food)`, grey "+N лишних" on overflow; saturation overlay only if the player model has it (check `P.sat`).
- **Held-item flash**: name and durability for 1 s on hotbar change. Chip: clock from `st.R.lighting.time`, optional XYZ (setting).
- **Update pattern**: same diff cache as `hudUpdate` (`st.hud` keys): compare a target key (x, y, z, id, state or mob id) each frame; rebuild text only on change; dynamic fields (mob hp, furnace progress) at 5 Hz.
- **Files**: new `kubomir-info.js`; setting row in the «🧊 Кубомир» tab; CSS next to the existing `.kb-*` rules.
- **Tests** (`kubomir-qol-test.cjs` part info): `canBreak` parity with dig logic (all blocks × all tools); text snapshots for 12 targets; hearts rounding; mod `info` sanitising and caps; zero steady allocations (`--expose-gc`, heap delta under 50 KB over 10 000 target changes); card content independent of dt (30/60/144).
- **Perf to measure**: average HUD cost at most 0.05 ms per frame (phone profile at most 0.2 ms); at most 8 DOM writes per second when still, 30 when sweeping; memory flat after 10 000 changes.

### 4.2 K1.2 Recipe browser I (M, lane B): index, browse, uses, sources, favorites, search, creative catalog
- **Shared module**: `D37E.recipes` (index builder from adapter lists, search, favorites) and `D37E.search` in `js/engine/recipes.js`; the Kubomir adapter feeds `V.recipes`, `V.smelting`, drops, ores and mob drops. Next adapters: Podzem (45 recipes), Мир goods, Studio3D custom recipes; the public pages (K1.14) read the same export.
- **Index** (`KubomirIndex`, built at world open and after mod apply; target at most 5 ms for 600 recipes on desktop, 20 ms on the phone profile, under 1 MB):
  ```js
  RecipeRec { key:'torch#a1b2', out:'torch', n:4, st:'bench|furnace|hand', w:3, h:3,
              grid:[ id | '#tag' | null ], mirror:true, ins:{ coal:1, stick:1 }, src:'vanilla|<modId>' }
  SourceRec { kind:'drop|ore|mob|smelt|craft|chest|tree', from:'ore_coal', detail:{ minY, maxY, biomes } }
  ```
  Maps: `byOut`, `byIn` (ingredient or tag → recipes), `sources[item]`. Sources come from block `drop` fields, `G.ores` (worldgen features), `MOBS[].drops`, `V.smelting`, a small hand table for special drops (leaves → apple/sapling), and later loot tables and crops.
- **H1 inside**: the grid matcher (`for (const r of V.recipes)`, `voxel.js` ~lines 247-275) gets a shape-hash map first and falls back to the old loop on a miss. Differential test: old vs new matcher on every recipe plus 5000 random grids must agree exactly.
- **UI**: sheet with tabs Можно сделать (N) / Все / Применение / Где взять / ★ / Каталог (creative only). Chips: Все, Блоки, Инструменты, Еда, Руды, Моды. Recipe card: output with count, station, 3x3 ghost grid, ingredient chips with have/need (green/red), tag members cycling in a tooltip. Entry points: inventory header 📖 (the old «Можно сделать» becomes tab 1), PC hover + R (recipes) / U (uses), phone long-press menu, pad Y, the target card link, the quest book. Favorites in `P.ext.fav` (at most 100, key = output + hash of normalised ingredients, so mod order does not matter). Creative «Каталог»: click takes a stack, Shift takes 64.
- **Search** (A9): one matcher, lowercased, Cyrillic-friendly, prefix then infix, synonyms table (кирка/pick), at most 1 ms per keystroke on 1500 entries (4 ms phone profile).
- **Hook for D2**: a locked recipe renders with 🔒 and a hint when `unlock` gating is active (inactive in Phase 1).
- **Files**: new `kubomir-recipes.js`; the only edit in `kubomir-ui.js` is the 📖 button and the hover hook; `voxel.js` matcher change (lane B owns it).
- **Tests**: index parity (every recipe under its output and each ingredient, tags expanded, smelting, sources); search ranking cases (кирк, pick, факел, железо); the differential matcher test; favorites persistence; mod recipe add/remove; 100 open/close with flat node and listener counts.
- **Perf to measure**: open at most 30 ms on the phone profile after warm-up; list scroll 60 fps with at most 24 rows; build and search times above.

### 4.3 K1.3 Recipe browser II (M, lane B after K1.2): tree, pinned goal, auto-fill, chooser
- **Shared module**: tree, pins and chooser live in `D37E.recipes`; only the put-in-grid button is Kubomir-specific.
- **Tree**: `expand(item, n, have)` picks the user's recipe or the first non-cyclic by priority, subtracts what you own, depth at most 8, memo, guard for compress/decompress pairs (9 ingots ↔ block). Output `{ raw:{id:n}, steps:[{key, times}], missing:{} }`.
- **Pins**: `P.ext.pins = [{item, n}]` (at most 3), HUD tracker under the minimap with "🪵 12/20" lines, refreshed on inventory events (`pickup`, `craft`, slot moves), never per frame.
- **Auto-fill**: «Положить» fills the open craft grid through the existing `fill/assign`; if no table is open it says "Нужен верстак".
- **Chooser**: when the matcher finds two or more distinct outputs for one grid, a small popup next to the result slot; the choice is remembered per grid hash in `P.ext.prefer`.
- **Tests**: tree totals for 20 known chains (torch, pickaxe tiers, lamp, door, stone bricks, bow); cycle safety; tag expansion; pin updates on events; chooser memory.
- **Perf**: tree at most 1 ms (desktop) at depth 8; pin refresh at most 0.05 ms per event.

### 4.4 K1.4 Inventory comfort (S–M, wave 2, after K1.3): gestures, crafting buttons, trash, auto-tool
- **Shared module**: the audit table is shared with the Podzem and Мир inventories; code stays in each game's inventory UI (different containers); the rules (conservation, undo trash) are helpers in `D37E.sheet`.
- **Step 1, audit** (table in the PR): wanted gestures vs existing in `kubomir-ui.js`: right-drag one each; wheel over a slot moves one or a stack to the other container; number key over a hovered slot swaps with the hotbar; Ctrl-click moves all of one type; Q / Ctrl-Q drops one / stack; middle-click clone (creative); double-click collect (exists), Shift-click quick move (exists), drag spread (`spreadEven`, exists).
- **Step 2, add the missing** plus: crafting buttons ↺ rotate / ⇆ balance / ✖ clear to inventory / ⮌ refill last recipe; trash slot with one-step undo (the last trashed stack can be restored until the inventory closes); phone: tap-hold = split, double-tap = quick move, the four buttons visible; pad: X quick move, Y split or recipes, LB/RB tabs.
- **Auto-tool** (A10): on dig start pick the best tool in the hotbar by the engine's own speed function, restore the previous slot 0.8 s after digging stops or on place/attack; never when the hand holds a placeable (block, torch) so nothing surprises; setting «Автовыбор инструмента» (default on for touch only).
- **Tests**: property test, 20 000 random operations (cursor included) conserve every item count whatever the path; auto-tool right for all blocks; restore logic.
- **Perf**: handlers O(1); no new per-frame work.

### 4.5 K1.5 World helpers (M–L, lane C): beds, sleeping bag, buckets, lift, light-ward lamp, light overlay
- **Shared module**: night and sleep rules in `D37E.sleep` (is-night callback, hostiles check, share of sleepers, time-skip hook) for Kubomir, Podzem beds and Мир flats (Живой город); the lift rule reuses the lift logic of `interior.js` if it fits; blocks and art stay Kubomir-only; Studio3D gets Bed, Lift and Spawn-blocker parts later.
All blocks are plain cubes in Phase 1 (no engine shape change; slab-shaped bed arrives with A30), art drawn by code in `voxel-tex.js` (mattress, arrows, lamp, three bucket sprites).
- **Bed «Лежанка»** (block): use → always sets `meta.bed = {x,y,z}` (toast «Дом здесь»). At night (use the game's own night test, not a hard-coded hour) and with no hostile mob within 8 blocks horizontally and 4 vertically (skipped on «Мирно» and in creative): 1.2 s fade (one CSS opacity transition on an overlay), set `st.R.lighting.time` to the morning hour, roll `meta.day` through the existing rollover, small rest bonus (`P.hp` at least 14), emit `sleep` then `wake`, toast «Доброе утро». The weather schedule is derived from day and hour (`KubomirWeather.at`), so it stays consistent; a test proves it. «Пережил ночь» counts when the night began with you. Respawn already reads `st.meta.bed || st.meta.spawn`; add a guard: bed block gone → fall back and say «Твоя лежанка пропала».
  Co-op hook: `KX.sleepVote(st)`; world rule «Ночь пропускают: один / половина / все» (default половина); solo skips at once.
- **Sleeping bag** (item, fiber x6 + stick x2, proposal): use on the ground sleeps by the same rules but sets a one-night spawn `meta.bag` that clears on wake; reusable.
- **Buckets** (after T-044 merges; read its notes first): items `bucket`, `bucket_water`, `bucket_lava` (stack 1; empty maybe 16). Use on a liquid with `V.liquidHeight(v)` full (a source) removes the block through the normal edit path (`onEdit`); use on a replaceable cell next to the target face places a full liquid block; sound and particles; recipe: 3 iron ingots in a V. If T-044 introduces an explicit source/flow model, follow it exactly. Milk bucket is Phase 2 (C12).
- **Lift «Подъёмник»**: standing on a lift block, jump (rising edge of the jump action) goes to the next lift above within 32 blocks that has 2 free cells over it; crouch (rising edge) goes down; short sound and particles; no fall damage. One block lookup per tick.
- **Light-ward lamp «Оберег света»**: recipe lamp + 2 gold ingots; stops natural hostile spawns within 24 blocks (not bosses or spawners). Ward positions in a per-chunk Set kept by `onEdit`; `X.spawn` asks `KX.spawnBlocked(x, y, z)` (one hook line in `kubomir-ents.js`, which T-020 must preserve).
- **Light overlay**: toggle (key proposal F7; pause-menu button on phone): one instanced plane mesh (capacity 1024) marking cells where hostiles could spawn (block light at most 7, solid floor, 2 air), radius 12, recomputed at 2 Hz in slices of at most 0.3 ms; off by default.
- **Files**: new `kubomir-world.js`; definitions in `voxel.js`/`voxel-tex.js` (lane C owns them in wave 1); one hook line in `kubomir-ents.js`.
- **Tests**: sleep matrix (day/night × hostiles × difficulty × creative × co-op rules); weather consistency across a skip; respawn with and without bed; bucket conservation over random scoop/place sequences; lift scan (blocked, out of range, several lifts); ward spawn blocking (10 000 attempts inside and outside the radius); save/load of `meta.bed/bag`; mods keep ids stable in `palette`; 30/60/144 invariance for all timers (game time, not frames).
- **Perf to measure**: lift check at most 0.002 ms per tick; ward check at most 0.01 ms per spawn attempt; overlay at most 0.3 ms per update, 1 draw call.

### 4.6 K1.6 Map I (M, lane D): minimap, waypoints, compass bar, death point
- **Shared module**: `D37E.mapkit` in `js/engine/mapkit.js` (tile store, minimap and fullscreen renderers, waypoint store, compass bar, name filter); the Kubomir adapter provides `tileAt`, `colorOf`, `worldToMap` and the mesher by-product; Мир phone map (WORLD_MAP), Podzem cave map and Studio3D map HUD get their own adapters.
- **Tile** (one per chunk column, produced as a by-product of the mesher so there is no second pass; if the worker protocol cannot take the extra field, compute on the main thread at chunk-ready, 0.05-0.2 ms per chunk):
  ```js
  Tile { v:1, cx, cz, top:Uint8Array(256) /* map-colour index of the top non-air block; water has its own */,
         h:Uint8Array(256) /* surface height */, wd:Uint8Array(256) /* water depth 0..15 */ }
  ```
  Map colours: block field `mapColor` (mods may set it; fallback = average of the block's texture, computed once at registry load, quantised to a 64-colour palette).
- **Storage**: IndexedDB store `maptiles` inside `d37-kubomir`, key `world:dim:cx,cz`, lazy batches (every 10 s, at most 64 tiles), in-memory LRU of 4096 tiles (about 2 MB); explored tiles show even before chunks stream in.
- **Waypoint**: `{ id, name (≤24), ic (emoji from 24 presets), col (0-7), x, y, z, dim, auto: null|'death'|'bed'|'camp'|'find', t }`; at most 64 in `P.ext.map.wp`; names go through the name filter; auto points are created by events (`knockout`, bed set, `camp`).
- **Minimap**: canvas 2D 128x128 (96 on phone), north-up or rotating (a prerendered north-up canvas rotated with `setTransform`), shading by height difference to the north/west neighbour. Redraw when the hero moved at least 1 block or a tile changed, throttled to 10 Hz; per-tile `rgba` Uint32 precomputed at tile creation so a redraw is block copies.
- **Compass bar**: a DOM strip at the top, cardinal letters and up to 8 markers within 400 blocks, moved with `transform: translateX` when yaw changes by 1° or more, at most 20 Hz.
- **Waypoint manager** sheet: list (icon, name, distance, arrow), add / rename / colour / delete, «показать столб» (optional world beacon, one instanced sprite batch, at most 16). Keys proposed: M map, N new waypoint (check `ACTS` for conflicts; both rebindable); phone: tap the minimap to open, long-press to add.
- **Survival gating**: setting «Карта»: «Сразу» (default) / «После предмета Карта»; creative and «Мирно» always on. World rule «Помощники» (K1.10) can lock it behind a quest.
- **Settings**: size S/M/L, shape, rotate, opacity, coordinates, waypoints in world.
- **Tests**: tile builder equals a brute-force column scan on 200 random chunks (water, leaves, caves); shading deterministic; every block has a map colour; waypoint CRUD, limit 64, name filter; death point lifecycle (removed when the last death drop is picked or after 10 min); `P.ext.map` round-trip; IndexedDB mock persistence; content independent of FPS; 200 open/close of the manager with flat counts.
- **Perf to measure**: minimap redraw at most 0.5 ms (desktop) and 2 ms (phone profile); average over 60 s of walking at most 0.1 ms per frame; mesher by-product at most +3 % chunk build time; tiles at most 2.2 MB; 0 WebGL draw calls.

### 4.7 K1.7 Map II (M, lane D): fullscreen map, grave, biome titles
- **Shared module**: fullscreen map and biome/zone titles are part of `D37E.mapkit`; the grave block is Kubomir-only (Podzem keeps items on knockout).
- **Fullscreen map** sheet: pan (drag / stick), zoom 0.5-4x (wheel / pinch / triggers), explored tiles from the cache even when chunks are unloaded, waypoints tappable; optional cave slice at Y (loaded chunks only).
- **Grave**: on knockout at «Обычно/Сложно», if a safe cell exists within 8 blocks (not lava or void), items go into a `grave` block tile (up to 36 slots, same container model as a chest) instead of loose drops; otherwise loose drops as today. It lasts 60 game-minutes, then contents drop for 5 more minutes. In co-op only the owner can open it for the first 5 minutes (host check). Map point «💀 Могила» until emptied. «Легко» keeps items on knockout as now (no grave).
- **Biome titles**: biome change checked at 4 Hz with the existing lookup; «🌲 Лес» top-centre for 2.2 s, once per biome per 5 minutes; reduced motion = no animation.
- **Tests**: knockout → grave or loose logic across difficulties; grave persistence; despawn in game time (30/60/144); screen-to-world transforms and tile coverage; title debounce.
- **Perf**: fullscreen redraw at most 2 ms (desktop) per frame while panning, 8 ms phone profile, offscreen caches.

### 4.8 K1.8 Camps (M, lane D after K1.7)
- **Shared module**: `D37E.travel` (named teleport list, cost and cooldown rules as data, safe-landing callback); the «Привал» block is Kubomir-only; Мир hub, metro and port teleports and the Studio3D Teleporter part use the same list.
- **Data**: `P.ext.camps[key] = {name, x, y, z, t}` (known to this player), `meta.shared.camps[key] = {x, y, z, owner, name}` (exists in the world); `key = x,y,z`. Tunable rules in one registry table, not in code: `{ free: 400, perBlock: 1/200 food, maxFood: 6, cooldownS: 20, combatLockS: 8 }` (all proposals, game balance only).
- **Block «Привал»** (recipe proposal: 4 stone bricks + 1 gold ingot + 1 flint). First use activates it and gives a name from a list of 40 own names; rename allowed (≤ 24 chars, filtered). Second use opens the «Привалы» sheet: list by distance, search, ⭐ pin, rename and forget (owner), teleport button.
- **Teleport**: preconditions: no damage taken in the last 8 s, cooldown over, enough food (creative: free). Ensure the destination chunks (the chunk-stream request in `voxel-stream.js` (confirm the exact call), wait at most 3 s under a loading overlay; cancel without cost on timeout), land on the nearest safe cell (reuse `safeSpot` of «Я застрял»), cost `min(maxFood, floor(dist/200))` food beyond the free range. Same dimension only (until E1).
- **Block gone** → entry greyed «пропал», removed on next open. Every camp is also an auto waypoint.
- **Tests**: activation and naming filter; cost formula; cooldown and combat lock in game time; unsafe destination fallback; timeout cancel; block break; save/load; shared registry stub for co-op; 30/60/144 invariance.
- **Perf**: list of 64 camps opens in at most 30 ms; teleport work = chunk ensure only.

### 4.9 K1.9 Finder compass (M, lane D after K1.8)
- **Shared module**: `D37E.finder` (time-sliced spiral search over a pure `biomeAt/structureAt`) and the shared catalog `D37E.biomes`; Kubomir first; Podzem (ore or biome by depth), Мир (find a place or friend) and the Studio3D Compass part later.
- **Item «Компас искателя»** (recipe proposal: 4 iron + 1 flint + 1 gold): held, shows a HUD arrow and distance; use opens the biome list.
- **Search**: a spiral over a 32-block grid sampling a pure `biomeAt(G, x, z)` of the seeded generator, in time slices of at most 2 ms per frame, radius cap 6000, results cached per (biome, origin cell); found → temporary waypoint (`auto:'find'`) and arrow; otherwise «Не нашёл в 6000 блоков».
- **Prerequisite**: the pure `biomeAt` must exist; if the generator only computes biome inside `genChunk`, the first commit extracts it with a parity test against `genChunk().biome` over 1000 random columns.
- **Discovery rule** (option): the list shows only biomes you have seen in your map tiles ("?" for the rest); creative shows all. Structures join the same list when C5 lands.
- **Tests**: parity of `biomeAt`; nearest found vs brute force on small radii; slice budget; cancellation; same result on 30/60/144 FPS.
- **Perf**: at most 2 ms per frame in slices, search at radius 3000 completes in under 1.5 s (measure), zero when idle.

### 4.10 K1.10 Quest book (M–L, wave 2 after K1.1)
- **Shared module**: `D37E.quests` in `js/engine/quests.js` (format, validator, event engine, sheet) with a reward-backend adapter: Kubomir gives in-world items only; Мир uses the site's server-verified daily and weekly quests (T-015, `quest_hub`); Podzem replaces GOALS with chapters; Studio3D gets a no-code Quest part writing the same JSON; Horde/TD show achievements as a chapter.
- **Format** (JSON, also valid as `quests[]` inside `mod.json`):
  ```json
  { "chapters":[ { "id":"first-night","title":"Первая ночь","icon":"🌙","order":1,
    "quests":[ { "id":"log","title":"Первое бревно","text":"…","icon":"log_oak","pos":[0,0],
      "needs":[],"hidden":false,
      "tasks":[{"t":"have","item":"#logs","n":1}],
      "rewards":[{"t":"item","id":"apple","n":2},{"t":"unlock","id":"recipe:crafting_table"}] } ] } ] }
  ```
  Task types: `have` (inventory count), `craft`, `smelt`, `break`, `place`, `kill`, `eat`, `visit` (biome), `reach` (distance from spawn), `sleep`, `use`, `days`, `check`. Rewards: `item`, `unlock` (recipe / feature / chapter), `cosmetic`, `title`. **Coins and XP are rejected by the validator** (red lines; economy caps).
- **Engine**: tasks indexed by event type; counters in `P.ext.quests[qid] = {p:[…], done, claimed}`; `have` recomputed only on inventory events; completion emits `quest` and goes through the notification center; `needs` dependencies with cycle detection at load; hidden quests appear when their needs are done.
- **UI**: sheet «Дорожная книга». Phone: chapter tabs on top, vertical quest list with status icons, details panel (text, task bars, reward preview, «Забрать» for non-auto rewards), pin up to 3 (tracker under the minimap), search. PC: left rail of chapters plus an optional graph tab using `pos`. Pad: LB/RB chapters, stick list, A claim. Key proposal J; phone 📜 button.
- **First content** (own text): «Первая ночь» (about 10: log, table, pickaxe, stone, furnace, iron, torch, bed, survive the night), «Мастерская» (tool tiers, chest), «Под землёй» (depth, coal, iron, gold, diamond, lava care), «Дом» (door, bed, lamp, 200 blocks), «Путешественник» (biomes, 1000 blocks, camp, compass). The 18 `ACH` achievements become chapter «Достижения» with the same ids, so `unlock(id)` and the server claim (`D37Coins.run('kubomir', n, 'kb:'+id)` inside the existing cap) are unchanged. `tipText` reads the first pinned unfinished quest (one source of truth).
- **D2 minimal**: world rule `rules.helpers = 'always' | 'earn'` (default always). In `earn`, the map, target card and finder compass are `unlock` rewards (feature flags checked by K1.1/K1.6/K1.9). Locked recipes show 🔒 (hook in K1.2).
- **Mods**: `quests[]` additive; chapters merge by id; at most 200 quests per mod; text through `textContent`, at most 400 chars.
- **Tests**: engine on synthetic event streams; deps and hidden logic; cycles; persistence; reward validator; achievement compatibility (ids, server claim once); mod chapter validation; 1000 events per second cost at most 0.2 ms; event-based so FPS-independent.
- **Perf**: open at most 30 ms; per event at most 0.02 ms; at most 200 KB for 300 quests.

### 4.11 K1.11 Backpack (M, wave 2 after K1.4)
- **Shared module**: extra item data and the pack container logic go through `D37E.sheet` helpers; the backpack itself is a Kubomir item first; Мир (wardrobe back slot, city lockers) and the Studio3D inventory API reuse it later.
- **Prerequisite, done first**: item extra data. Slot becomes `{id, n, d, x?}` where `x` is plain JSON of at most 2 KB. Rules: items with `x` never stack; deep-cloned on pick, drop, chest moves; saved with `meta.player`; survive knockout drops; `player.give` from mods cannot set `x`; `voxel-store` and the co-op sync (T-019) are told about the new field in the PR.
- **Data**: `x = { v:1, inv:[{id,n,d}|null x N], up:['magnet'|null, …] }`. Tiers `pack_s` 18, `pack_m` 36, `pack_l` 54 slots (proposals). Upgrades: `up_magnet` (pulls loose items within 4 blocks that pass the filter when the pack is in the hotbar or worn, 4 Hz), `up_eat` (eats the best food when `P.food` ≤ 10, one item per 2 s), `up_sort` (button), `up_filter` (whitelist of 9).
- **Crafting** (proposals): `pack_s` 6 fiber + 2 stick; `pack_m` = `pack_s` + 4 iron + 2 fiber; `pack_l` = `pack_m` + 2 diamond + 4 iron.
- **UI**: use in hand or key B (check conflicts); a container kind `pack` in `cont()` with the same transactional moves as a chest; side tab for upgrades; **no nesting** (a pack cannot enter a pack); «Переложить всё»; sort through `U.sort`. Worn on the back through the character's back slot; skins are 💎 cosmetics only.
- **Tests**: fuzz 20 000 operations (move, split, merge, drop, pickup, knockout, save/load): counts conserved, no duplicates, no nesting; magnet and eat ticks in game time; size limits; mods cannot forge `x`.
- **Perf**: open at most 30 ms; magnet check at most 0.02 ms per tick; save size +1.5 KB per full pack.

### 4.12 K1.12 Settings pack (S, wave 3, after T-043)
- **Shared module**: already shared by design: D37Settings Controls tab, `D37E.notify`, volume categories apply to every game.
- **Key search**: in the shared controls tab (`settings.js`, used by all games): search by action label or key, «Конфликты» filter (actions sharing a key), «Нажми клавишу, чтобы найти действие» (captures the next key), reset one binding. Sources: `KubomirInput.ACTS` and the engine controls.
- **Notification center**: `KX.notify(cat, text, icon)`; categories achievement / quest / tip / item / system; per-category on/off, duration 2-8 s, top or bottom, quiet mode (only quest and system), history sheet (30). All current toasts route through it. Stored in `d37_kb_opt`.
- **Sound sliders**: `volSteps, volMobs, volWeather, volMusic, volUI` keys in `D37Opt`, applied in `synth.js` via a sound-id → category table (engine file: coordinate with its owner; otherwise a Kubomir-only wrapper).
- **Tests**: filter and conflict logic; history ring buffer; category routing; persistence. **Perf**: trivial.

### 4.13 K1.13 Smart mining and fast leaf decay (S–M, wave 3)
- **Shared module**: `D37E.veins` (BFS with caps and a cost callback) for Kubomir and Podzem (2D); Мир jobs may call it for batch gathering.
- **Toggle** `vein` (action; phone button; pad combo; off in hardcore and when `rules.vein` is false). When on and the broken block is in `#ores` or `#logs`: BFS over same-id neighbours (6 for ores, 26 for logs) within 8 blocks, caps 16 ores / 64 logs; each extra block costs 1 durability and 0.1 food and goes through the normal `breakBlock` path so drops, events and achievements stay consistent; at most 8 blocks per tick to spread remeshing.
- **Fast leaf decay**: leaves with no log within 4 blocks vanish over 3-8 s (seeded by position, so deterministic) after the logs go, with normal sapling/apple chances. Player-placed leaves must not decay: mark them with state bit 0 when placed (check that leaves do not use the nibble).
- **Tests**: BFS caps; cost accounting; drops identical to manual breaking; decay determinism at 30/60/144; placed leaves persist. **Perf**: BFS at most 0.3 ms for 64 blocks.

### 4.14 K1.14 Public recipe pages for search (S–M, wave 3 after K1.2)
- **Shared module**: the data export (an `api/_lib/` generator) takes any game's adapter output: Podzem recipe pages next, then /bestiary.
- **Data**: `scripts/make-kubomir-data.mjs` loads the registry in node (as the tests do) and writes the checked-in `api/_lib/kubomir-data.js` (blocks, items, recipes, sources, mobs, biomes, achievements); a test fails if it is out of date (same pattern as `make-errlog`).
- **Routes**: `/games/kubomir/recipes` and `/games/kubomir/recipes/<item>` as entries in `api/pages.js` ROUTES (no new function: stays 10 of 12) + rewrite in `vercel.json` + sitemap entries. Page: «Как сделать <предмет> в Кубомире», the recipe drawn in HTML/CSS (no image files needed), «Где взять», «Для чего нужен», FAQ JSON-LD, link «Играть» → `/play/kubomir`. Own text only; standard ads (nothing gambling-related).
- **Tests**: data parity with the registry; all pages render; JSON-LD valid; sitemap count.

### 4.15 K1.15 Chest finder (M, optional, wave 3 after K1.2)
- **Shared module**: the chest index is Kubomir-only; Podzem «📦 в сундуки рядом» can gain the same search through `D37E.search`.
- Index of chests from loaded chunk tiles (`Map<chunk, [{pos, counts}]>`, updated on chest edits and chunk loads); query returns the 8 nearest with counts; one `InstancedMesh` (at most 32) outlines them for 3 s with depth test off; phone: tap a result shows an arrow on the compass bar. Radius 48, loaded chunks only, own world only.
- **Tests**: index equals brute force; updates on edits; cap. **Perf**: query at most 0.5 ms.

---

## 5. Cross-cutting rules

### 5.1 State ownership
`P.ext.<feature>` per player (waypoints, quests, camps, favorites, pins); `meta.shared.<feature>` per world (camps registry, claims later); `meta.rules` per world (`helpers`, `vein`, `fell`, `sleepShare`, `horror`). No new top-level `meta` keys without an entry in the K1.0 list. This is what lets T-019 partition per-player data and sync shared data through the host.

### 5.2 Input actions (proposals; check `ACTS` for conflicts, every one rebindable)
| Action | PC | Pad | Phone |
|---|---|---|---|
| recipes / uses | R / U (hover or aim) | Y on an item | long-press menu, 📖 |
| map | M | View | tap minimap |
| new waypoint | N | long-press map | long-press minimap |
| quest book | J | menu | 📜 |
| backpack | B | menu | 🎒 |
| target card toggle | H | menu | settings |
| spawn overlay | F7 | menu | pause menu |
| vein toggle | V | combo | button |
| camp list | use the block | A on the block | tap the block |

### 5.3 Settings
Everything lives in the «🧊 Кубомир» tab (`D37Settings.addTab`, rows with `data-kbo`), under a new section «Помощники». World rules are chosen at world creation and can be changed in the pause menu.

### 5.4 Mod format additions (api 1, additive, validated in `voxel-mods.js`, tested in `voxel-test`)
Block and item `info: ["…"]` (≤ 4 lines × 80 chars); block `mapColor`; `tags: { "name": ["id", …] }`; recipe fields `remove`, `replace`, `unlock`; `quests[]` (K1.10); `trades[]` (Phase 2); events `sleep`, `wake`, `craft`, `eat`, `questDone`, `campUse`; read-only sandbox helpers `player.has(item)`, `quests.isDone(id)` (mods may not complete quests or grant coins).

### 5.5 Test and performance protocol (every task, numbers in the final report)
- Node tests named in each spec, added to `TESTS` in `scripts/ci-run.cjs`.
- 30/60/144 FPS invariance for anything time-based (cooldowns, timers in game time, not frames).
- Leaks: 20 open/close per sheet (200 for the map manager): DOM node and listener counts flat.
- Soak: `KB_MODE=soak` 10 minutes of random play with all features on: 0 errors and warnings, listeners flat, memory plateau.
- Perf: `KB_MODE=perf`, phone profile 844x390, CPU x4, "mid": milliseconds per frame before/after for idle, walking, map open, recipe sheet open, 100 target changes; thresholds are the budgets of §2.
- Screens: new `KB_MODE=qol` in `scripts/kubomir-e2e.cjs` (desktop 1280x675, phone landscape and portrait) to `E:\claude-tmp\kbqol\shots`.
- Fallback: any feature that throws disables itself for the session; the game keeps running.

---

## 6. Design sketches for Phases 2-4 (so Phase 1 does not paint us into a corner)

### 6.1 Mob rig, AI verbs, spawn rules (C1, joins T-020)
```json
{ "id":"fox-red","title":"Рыжая лиса","size":[.7,.6],"hp":10,"speed":2.2,
  "bones":[{"n":"body","box":[0,.25,0,.5,.35,.9],"col":"#d9722b"},{"n":"head","parent":"body","box":[0,.1,.55,.35,.3,.35],"col":"#e88a40"}],
  "anim":{"walk":[["legs","x",0.6,6]],"idle":[["tail","y",0.2,1.5]]},
  "ai":["wander","flee:player:6","sleep:day"],
  "spawn":{"biomes":["forest","taiga"],"time":"night","light":"<=7","weight":8,"group":[1,3],"max":4},
  "drops":[["meat_raw",0,2]] }
```
One format for built-in and modded mobs; at most 6 draw calls per mob (merged boxes), instancing by type, at most 24 rendered; the ward lamp and difficulty table both act on the spawn rule.

### 6.2 Structures (C5)
Pieces with connectors and a seeded jigsaw: `{ "id":"ruined-tower","pieces":[{"id":"base","size":[7,5,7],"blocks":"rle:…","conn":[["N",3,0]]}],"rules":{"biomes":["plains","forest"],"spacing":[24,12],"salt":1129,"minY":"surface"},"loot":{"chest":"tower_t1"} }`. Placement per chunk in the worker at most 1.5 ms; loot tables as weighted pools; per-player chests keyed by player id on the host (G4). Our own pieces only.

### 6.3 Farming tick budget (C9)
Random ticks in loaded chunks: 3 per 16x16x16 section per second, spread over frames, at most 0.2 ms per frame; crops carry growth in the state nibble (8 stages fit); light, water within 4 blocks, season factor from the climate world (T-001) and frost kill in winter zones; offline growth by time formula on chunk load (like the lazy economy), not by simulating the gap.

### 6.4 Dimensions, planets, space (E1-E7) and the link to «Вселенная»
- `meta.dims[id] = { seed, profile, spawn }`; chunk keys become `(dim, cx, cz)`; each dimension has its own time and weather rules; a portal registry in `meta.shared.portals`.
- **PlanetProfile** is the shared contract with `docs/superpowers/specs/2026-10-16-universe-design.md` (§9: Kubomir is "a block-planet type of place"; step 7 imports it):
  ```json
  { "id":"moon","title":"Луна","g":0.4,"air":false,"temp":-60,"dayLen":2400,
    "sky":{"top":"#05060a","sun":0.6},
    "gen":{"base":"flat-craters","blocks":{"top":"regolith","fill":"moon_rock"},"ores":["ice","titanium"]},
    "hazards":["vacuum"],"mobs":[],"requires":{"rocket":1} }
  ```
- Rockets: tier 1 Moon, tier 2 Mars, tier 3 Venus; fuel and launch pad; the countdown and flight are a loading screen (a natural ad slot per the Universe spec §8); suit with oxygen tank or sealed rooms with an oxygen block; a return trip needs fuel. Gravity `g` scales jump and fall (fixed step, so same on all devices).
- Do not build a second space model: freeze the profile with the Universe team before E5.

### 6.5 Horror gating (F1-F6)
World rule `horror: off | dark | full` chosen at creation; `dark` (12+) = sanity vignette, whispers, one stalker type; `full` (16+) = stronger sound cues and more stalker types; **never gore, never death** (knockout and fade). Below 13 needs the existing adult-allowed path. «Свет» is a one-tap switch that turns it all off and swaps scary mobs for silly ones. SCP-like and named creepypasta entities are never built.

### 6.6 Skill path and ages (D2, D3)
Skills (Mining, Fighting, Building, Exploring, Farming): XP from events (not from time), a point per level, three bounded perks each (mining speed +x %, longer breath, softer falls, faster bow draw), switchable respec in the pause menu; per world; **no link to the site's XP or coins**. Ages reuse the quest book: each age is a chapter whose last quest has an `unlock` list; locked recipes show 🔒 with the hint; per player.

---

## 7. Decisions needed from the owner (5) and risks

### Decisions
1. **Helpers**: «Сразу» (default for new worlds, friendly to kids and phones) or «Открывать за прогресс» (SevTech style) as a world preset «Путешественник»? Recommendation: both, default «Сразу».
2. **Horror mode**: build it (opt-in, 12+/16+, no gore) at the end of Phase 2, or skip? Recommendation: decide later; Phase 1 does not depend on it.
3. **Camp teleport cost**: food beyond 400 blocks plus a 20 s pause (recommended), pause only, or an item.
4. **Map in survival**: always on (recommended) or only after crafting a «Карта».
5. **Public recipe pages** for search (K1.14): yes (recommended; reuses game data, standard ads) or no.

### Risks
- `kubomir.js` conflicts: solved by the §4.0 seam; no lane edits that file except through marked hooks.
- Mesher worker protocol (map tile by-product) overlaps T-044 files: fall back to main-thread tiles; decide after T-044 merges.
- Item extra data (backpack) touches the save format and the co-op sync: done first, announced in the PR, tested for round-trip.
- Per-player state vs T-019's model: `P.ext` assumes a per-player object; confirm after the merge, adapt K1.0 only.
- Phone performance: every item has a budget and a measurement; features can be switched off in settings.
- Legal: names, art, text and structures are ours; third-party IP never; the importer stays personal.
- Audience: combat and horror labels follow `D37Age`; text filters on every player-visible name.
- Scope: Phase 1 is deliberately helpers only; content waits for T-020 and T-021 so mob and art work is not duplicated.

---

## Appendix. Evidence and sources

### Design evidence read from the owner's instances (structure only, nothing copied)
- **DDSS2** quest chapters tier_0 to tier_6, one file each; the order of unlocks is the ladder in §1E; tier 0 hands out a starter kit through a reward table and marks optional quests with a different shape (round) and `hide` flags.
- **SevTech** `stages.zs`: stages tutorial, zero, one to five, creative; mob stages zero_mob to five_mob; metal stages; unique stages including `mapping`; `staging/` categories: containers, dimensions, enchantments, items and recipes, journeymap, liquids and gases, mob gear, mobs, multiblock, ores, tinkers, waila. `item_modifiers/` adds descriptions and tooltips.
- **FTB Quests** (ATM10, Craftoria, SB3, DDSS2, DRK, CHP): a chapter has a title, icon, default quest shape and images; a quest has position, shape, dependencies, `hide`, tasks (checkmark, item with count, advancement, and others), rewards (item, xp, command, reward table); reward tables are weighted loot pools in their own folder (SB3 keeps a 44 KB one).
- **CHP** "first night" chain: wood, cobblestone, iron, sleep through the night, each with a small food reward and a one-line reason ("why you need this").
- **ATM10** `tooltips.js`: tier needed to mine and where an ore is found, as tooltip lines. **DDSS2** `Item_infos_JEI.js`, `ores_and_materials_JEI.js`: hand-written info pages in the recipe viewer. **SB3** `ui.js`, `info_tabs.js`, `show_and_hide.js`: custom information tabs and hiding clutter.

### Web sources used (checked 2026-10-22)
- DDSS2 overview and counts: https://www.curseforge.com/projects/1295260 ; Prominence II: https://www.curseforge.com/minecraft/modpacks/prominence-2-fabric ; Solo Leveling Reawakening: https://www.modpackindex.com/mod/58939/solo-leveling-reawakening ; Cave Horror Project: https://www.modpackindex.com/modpack/146494/chp ; Endless Horror: https://www.creeperhost.net/modpack/c1194574-endless-horror-the-ultimate-horror-experience ; SevTech Ages: https://shockbyte.com/modpacks/sevtech-ages
- Waystones changelogs: https://www.curseforge.com/minecraft/mc-mods/waystones/files/5140917 ; JourneyMap docs: https://journeymap.readthedocs.io/en/latest/client/full-screen/ and https://blog.curseforge.com/journeymap-mod-frequently-asked-questions/ ; Sophisticated Backpacks: https://www.curseforge.com/minecraft/mc-mods/sophisticated-backpacks ; EMI: https://www.curseforge.com/minecraft/mc-mods/emi ; Jade: https://minecraft.how/mod/jade ; Ad Astra: https://modrinth.com/mod/ad-astra ; FTB Quests overview: https://www.9minecraft.net/ftb-quests-mod ; popularity listicle: https://everythingedinburgh.com/games/gaming/best-minecraft-mods/
- Anything not marked (W) comes from general knowledge of the mods; descriptions were not available in the inventory.

### Repository documents used
CLAUDE.md («Кубомир», «Подземье», «Движок D37E», master instruction), `docs/MOBS.md`, `docs/KUBOMIR_ART.md`, `docs/PHYSICS_PLAN.md`, `docs/COMBAT.md`, `docs/MODS.md`, `docs/TASKS.md`, `docs/superpowers/specs/2026-10-16-universe-design.md`, `docs/plans/universe-step1.md` (format reference).
