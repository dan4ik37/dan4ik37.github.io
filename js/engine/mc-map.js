// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — таблица «блоки Minecraft → блоки Кубомира» (перенос построек, миров, модов). Данные, не код Mojang
// ═══════════════════════════════════════
// MC.resolve('minecraft:oak_log[axis=x]') → { name: 'log_oak', st: 1 } — наш блок и его состояние (ось, сторона, дверь…);
// { name: 'mc:red_wool' } — своего нет, но цвет известен: такой блок «Кубомир» создаёт сам (цветной кубик; с пакетом текстур —
// с его картинкой); { name: 'missing', unknown: true } — не знаем (видно розово-чёрным, в отчёте); { name: 'air', thin: true } —
// тонкое (ковры, кнопки, рельсы, таблички) пропускаем. Ступени, плиты, заборы, стены — целым блоком своего материала.
// Таблицу можно дополнять модами: mod.json «minecraft»: { "blocks": { "minecraft:имя": "наш_блок" } } → MC.extend().
// Цвета — средний цвет блока «на глаз» (свои числа). Имена Bedrock (wool + color, planks + wood_type…) приводятся к Java.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const MC = E.mc = E.mc || {};

  // ── прямые соответствия: имя → наш блок; { b, r } — правило состояния (axis, walltorch, ladder, door, facing, furnace, liquid, lamp)
  const A = (b, r) => ({ b, r });
  const B = {
    air: 'air', cave_air: 'air', void_air: 'air', structure_void: 'air', barrier: 'air', light: 'air', moving_piston: 'air',
    stone: 'stone', cobblestone: 'cobble', mossy_cobblestone: 'mossy_cobble', infested_stone: 'stone', infested_cobblestone: 'cobble',
    dirt: 'dirt', coarse_dirt: 'dirt', rooted_dirt: 'dirt', grass_block: 'grass', sand: 'sand', gravel: 'gravel', suspicious_sand: 'sand', suspicious_gravel: 'gravel',
    bedrock: 'bedrock', water: A('water', 'liquid'), lava: A('lava', 'liquid'), bubble_column: A('water', 'liquid'),
    oak_log: A('log_oak', 'axis'), oak_wood: A('log_oak', 'axis'), stripped_oak_log: A('log_oak', 'axis'), stripped_oak_wood: A('log_oak', 'axis'),
    birch_log: A('log_birch', 'axis'), birch_wood: A('log_birch', 'axis'), stripped_birch_log: A('log_birch', 'axis'), stripped_birch_wood: A('log_birch', 'axis'),
    spruce_log: A('log_spruce', 'axis'), spruce_wood: A('log_spruce', 'axis'), stripped_spruce_log: A('log_spruce', 'axis'), stripped_spruce_wood: A('log_spruce', 'axis'),
    oak_leaves: 'leaves_oak', birch_leaves: 'leaves_birch', spruce_leaves: 'leaves_spruce',
    oak_planks: 'planks_oak', birch_planks: 'planks_birch', spruce_planks: 'planks_spruce',
    sandstone: 'sandstone', snow_block: 'snow', ice: 'ice', packed_ice: 'ice', blue_ice: 'ice', frosted_ice: 'ice', clay: 'clay',
    coal_ore: 'ore_coal', deepslate_coal_ore: 'ore_coal', iron_ore: 'ore_iron', deepslate_iron_ore: 'ore_iron', gold_ore: 'ore_gold', deepslate_gold_ore: 'ore_gold',
    diamond_ore: 'ore_diamond', deepslate_diamond_ore: 'ore_diamond',
    glass: 'glass', glass_pane: 'glass', cactus: 'cactus',
    short_grass: 'tall_grass', grass: 'tall_grass', fern: 'tall_grass', tall_grass: 'tall_grass', large_fern: 'tall_grass', seagrass: 'air', tall_seagrass: 'air',
    dandelion: 'flower_yellow', sunflower: 'flower_yellow', poppy: 'flower_red', rose_bush: 'flower_red', red_tulip: 'flower_red', dead_bush: 'dead_bush',
    torch: 'torch', wall_torch: A('torch', 'walltorch'), soul_torch: 'torch', soul_wall_torch: A('torch', 'walltorch'), redstone_torch: 'torch', redstone_wall_torch: A('torch', 'walltorch'),
    lantern: 'torch', soul_lantern: 'torch', campfire: 'torch', soul_campfire: 'torch',
    crafting_table: 'crafting_table', furnace: A('furnace', 'furnace'), blast_furnace: A('furnace', 'furnace'), smoker: A('furnace', 'furnace'),
    chest: A('chest', 'facing'), trapped_chest: A('chest', 'facing'), barrel: 'chest', ladder: A('ladder', 'ladder'),
    oak_door: A('door_oak', 'door'), spruce_door: A('door_oak', 'door'), birch_door: A('door_oak', 'door'), jungle_door: A('door_oak', 'door'), acacia_door: A('door_oak', 'door'),
    dark_oak_door: A('door_oak', 'door'), mangrove_door: A('door_oak', 'door'), cherry_door: A('door_oak', 'door'), bamboo_door: A('door_oak', 'door'),
    crimson_door: A('door_oak', 'door'), warped_door: A('door_oak', 'door'), iron_door: A('door_oak', 'door'),
    bricks: 'bricks', stone_bricks: 'stone_bricks', mossy_stone_bricks: 'stone_bricks', cracked_stone_bricks: 'stone_bricks', chiseled_stone_bricks: 'stone_bricks',
    infested_stone_bricks: 'stone_bricks', glowstone: 'lamp', sea_lantern: 'lamp', shroomlight: 'lamp', redstone_lamp: A('lamp', 'lamp'), jack_o_lantern: 'lamp',
    ochre_froglight: 'lamp', verdant_froglight: 'lamp', pearlescent_froglight: 'lamp', beacon: 'lamp',
    obsidian: 'obsidian', crying_obsidian: 'obsidian', iron_block: 'iron_block', gold_block: 'gold_block', diamond_block: 'diamond_block',
    oak_sapling: 'sapling_oak', birch_sapling: 'sapling_birch', spruce_sapling: 'sapling_spruce', slime_block: 'bouncer',
  };
  // тонкое и мелкое — пропускаем (в Кубомире таких форм нет)
  const THIN_RE = /(_carpet|_button|_pressure_plate|_sign|_wall_sign|_hanging_sign|_banner|_wall_banner|_bed|_trapdoor|_head|_skull|_wall_head|_wall_skull|_candle|_candle_cake|_coral|_coral_fan|_coral_wall_fan|_rail|_bars|_pane|_vines?|_roots|_sprouts|_sapling|_mushroom|_bush|_tulip|_orchid|_allium|_bluet|_daisy|_cornflower|_lily_of_the_valley|_wither_rose|_lilac|_peony|_pitcher_plant|_torchflower|_petals|_dripleaf|_lichen|_amethyst_bud|_cluster|_pot|_plate|_layer|_chain)$/;
  const THIN = new Set(['snow', 'rail', 'redstone_wire', 'tripwire', 'tripwire_hook', 'lever', 'cobweb', 'vine', 'flower_pot', 'repeater', 'comparator', 'string', 'scaffolding', 'chain', 'iron_bars',
    'lily_pad', 'sugar_cane', 'bamboo', 'kelp', 'kelp_plant', 'wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart', 'cocoa', 'sweet_berry_bush', 'cave_vines', 'cave_vines_plant',
    'twisting_vines', 'weeping_vines', 'glow_lichen', 'sculk_vein', 'fire', 'soul_fire', 'end_rod', 'lightning_rod', 'bell', 'brewing_stand', 'cake', 'conduit', 'dragon_egg', 'turtle_egg',
    'sniffer_egg', 'sea_pickle', 'spore_blossom', 'hanging_roots', 'pointed_dripstone', 'small_amethyst_bud', 'nether_portal', 'end_portal', 'end_gateway', 'decorated_pot', 'frogspawn',
    'azure_bluet', 'oxeye_daisy', 'pink_petals', 'big_dripleaf', 'small_dripleaf', 'glow_berries', 'moss_carpet', 'pale_moss_carpet', 'heavy_core', 'tripwire', 'powder_snow']);
  // средний цвет блока (свои числа «на глаз») — для блоков, которых в Кубомире нет: «Кубомир» делает такой цветной кубик
  const COL = {};
  const put = (names, cols) => names.split(' ').forEach((n, i) => { COL[n] = '#' + cols.split(' ')[i]; });
  const DYES = 'white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black';
  const dye = (suffix, cols) => put(DYES.split(' ').map(c => c + suffix).join(' '), cols);
  dye('_wool', 'e9ecec f07613 bd44b3 3aafd9 f8c527 70b919 ed8dac 3e4447 8e8e86 158991 792aac 35399d 724728 546d1b a12722 141519');
  dye('_concrete', 'cfd5d6 e06101 a9309f 2389c7 f1af15 5ea918 d6658f 36393d 7d7d73 157788 64209c 2d2f8f 603c20 495b24 8e2121 080a0f');
  dye('_concrete_powder', 'e2e4e4 e3843a c053b9 4ab4d5 e9c637 7dbd2a e59ab5 4d5155 9b9b94 24939d 8338b1 4649a6 7e5536 61773a a83633 191a1f');
  dye('_terracotta', 'd1b2a1 a15325 95586c 716c89 ba8523 677534 a14e4e 392a23 876a61 575b5b 764656 4a3b5b 4d3323 4c532a 8f3d2e 251610');
  dye('_glazed_terracotta', 'bcd4ca 9a9348 d064bf 5e98c6 eac058 a2c537 eb9aab 535a5d 90a6a7 34767d 6d3098 2f408b 775a3a 758e43 b53b35 431e20');
  dye('_stained_glass', 'f2f2f2 d87f33 b24cd8 6699d8 e5e533 7fcc19 f27fa5 4c4c4c 999999 4c7f99 7f3fb2 334cb2 664c33 667f33 993333 191919');
  dye('_shulker_box', 'd7dcdd e96f0a ad3ea4 3aafd9 f8bd1d 64ad17 ef8fae 3e4447 7c7c73 158991 7a2aac 35399d 724728 546d1b 8c1f1e 191920');
  put('terracotta jungle_planks acacia_planks dark_oak_planks mangrove_planks cherry_planks bamboo_planks bamboo_mosaic crimson_planks warped_planks pale_oak_planks',
    '985e43 a07350 a85a32 42291a 763631 e2b4ac c2ad50 bea94c 653147 2b6963 e3d9d4');
  put('jungle_log acacia_log dark_oak_log mangrove_log cherry_log crimson_stem warped_stem bamboo_block pale_oak_log jungle_wood acacia_wood dark_oak_wood mangrove_wood cherry_wood crimson_hyphae warped_hyphae',
    '564419 696259 3c2e1a 544329 36202d 5c1a1e 3a3a4d 7f8f30 4f4a46 564419 696259 3c2e1a 544329 36202d 5c1a1e 3a3a4d');
  put('stripped_jungle_log stripped_acacia_log stripped_dark_oak_log stripped_mangrove_log stripped_cherry_log stripped_crimson_stem stripped_warped_stem stripped_bamboo_block',
    'ab8455 ae5d3b 483827 77362f d79a97 89395a 3a9693 c0af4f');
  put('jungle_leaves acacia_leaves dark_oak_leaves mangrove_leaves cherry_leaves azalea_leaves flowering_azalea_leaves pale_oak_leaves',
    '30801f 5e8a2a 3b6e1d 477f1e e5adc2 5a7525 637032 8a8e86');
  put('granite polished_granite diorite polished_diorite andesite polished_andesite deepslate cobbled_deepslate polished_deepslate deepslate_bricks cracked_deepslate_bricks deepslate_tiles cracked_deepslate_tiles chiseled_deepslate reinforced_deepslate',
    '956756 9a6a59 bcbcbc c1c1c3 888889 848685 505053 4d4d50 484849 464648 404042 363637 333334 363637 505052');
  put('tuff polished_tuff tuff_bricks chiseled_tuff calcite smooth_stone dripstone_block blackstone polished_blackstone polished_blackstone_bricks cracked_polished_blackstone_bricks chiseled_polished_blackstone gilded_blackstone basalt polished_basalt smooth_basalt',
    '6c6d66 626862 626862 5c605a dfe0dc 9e9e9e 866b5c 2a2329 353038 302a32 2c262c 353035 382b26 4b4a4e 595959 48484e');
  put('netherrack nether_bricks cracked_nether_bricks chiseled_nether_bricks red_nether_bricks end_stone end_stone_bricks purpur_block purpur_pillar prismarine prismarine_bricks dark_prismarine',
    '622626 2c1519 281416 2f171c 450709 dbde9e dae0a2 a97da9 ab81ab 639c97 63aba0 335b4b');
  put('quartz_block smooth_quartz chiseled_quartz_block quartz_pillar quartz_bricks red_sand red_sandstone cut_red_sandstone chiseled_red_sandstone smooth_red_sandstone smooth_sandstone cut_sandstone chiseled_sandstone',
    'ece6df ece6df e7e2da ebe6e0 eae5dd be6621 b5621f bd6620 b35f1d b5621f e0d6aa d9cf9e d8cb9b');
  put('mud mud_bricks packed_mud moss_block mycelium podzol dirt_path farmland soul_sand soul_soil magma_block crimson_nylium warped_nylium sculk sculk_catalyst sculk_shrieker sculk_sensor',
    '3c393d 89684f 8e6b50 596d2d 6f6265 5b3f18 94793c 8f6743 513e33 4b3a2f 8e3f1f 821f1f 2b7265 0d1e24 0f2026 0f2026 0c3a46');
  put('copper_block exposed_copper weathered_copper oxidized_copper cut_copper exposed_cut_copper weathered_cut_copper oxidized_cut_copper chiseled_copper copper_grate copper_bulb',
    'c06b4f a17e68 6d9370 52a283 bf6a50 9a7765 6c926f 4f9a7f b8644c c06b4f 9c5a40');
  put('raw_iron_block raw_copper_block raw_gold_block emerald_block lapis_block redstone_block coal_block netherite_block amethyst_block budding_amethyst ancient_debris',
    'a6876b 9a6a4f dda92e 2acb57 1e438c af1806 101010 42403f 8562c0 84609f 5f4840');
  put('copper_ore deepslate_copper_ore emerald_ore deepslate_emerald_ore lapis_ore deepslate_lapis_ore redstone_ore deepslate_redstone_ore nether_quartz_ore nether_gold_ore',
    '7c7d77 5c5d59 75837a 5e6b61 637091 4f5a75 8c6e6e 694e4f 75413e 734631');
  put('hay_block melon pumpkin carved_pumpkin sponge wet_sponge bookshelf chiseled_bookshelf note_block jukebox tnt target honey_block honeycomb_block bone_block dried_kelp_block',
    'a68b0c 6f9118 c6761a b46b17 c3c04b ab9d3c 6b5537 7a6346 58392a 5d3e2b db441a e6c3ad fbbd39 e59c26 e2ddc7 30382b');
  put('nether_wart_block warped_wart_block brown_mushroom_block red_mushroom_block mushroom_stem powder_snow tinted_glass loom cartography_table fletching_table smithing_table stonecutter lectern composter beehive bee_nest',
    '730303 167b84 956f51 c82f2d cbc4b9 f8fdfd 2d2830 8e7b62 685133 b4a07a 3b3d4b 7b7672 b08b54 6e4a2c b5925a b7883c');
  put('enchanting_table anvil chipped_anvil damaged_anvil cauldron hopper dispenser dropper observer piston sticky_piston crafter respawn_anchor lodestone grindstone ender_chest spawner trial_spawner vault',
    '5c2b40 444444 444444 444444 4a4a4a 494a4e 717171 717171 646464 9b8963 8a9a63 6e6466 2f1f42 77787b 8e8e8e 1d2d2f 252b31 2f3a42 3c4148');
  put('glow_lichen ice_block resin_block resin_bricks pale_moss_block creaking_heart', '70827a b0c8ff db6a1d cf5b1b 6b706b 4f4740');
  // свет, который такие блоки дают (уровень) и его цвет
  const EMIT = { glowstone: 15, sea_lantern: 15, shroomlight: 15, jack_o_lantern: 15, beacon: 15, ochre_froglight: 15, verdant_froglight: 15, pearlescent_froglight: 15,
    redstone_lamp: 15, magma_block: 3, crying_obsidian: 10, respawn_anchor: 0, copper_bulb: 15, lantern: 15, soul_lantern: 10, soul_torch: 10, campfire: 15, soul_campfire: 10,
    end_rod: 14, sea_pickle: 6, glow_lichen: 7, amethyst_cluster: 5, enchanting_table: 7, ender_chest: 7, sculk_catalyst: 6, conduit: 15, lava: 15, fire: 15 };
  const LCOL = { glowstone: '#ffd98a', sea_lantern: '#c8f2ff', shroomlight: '#ffb35a', jack_o_lantern: '#ffc060', beacon: '#9ff5ff', ochre_froglight: '#ffe9a0', verdant_froglight: '#d8ffd0',
    pearlescent_froglight: '#ffd8f0', redstone_lamp: '#ffd8a0', magma_block: '#ff6020', crying_obsidian: '#a040ff', soul_lantern: '#70d8ff', soul_torch: '#70d8ff', soul_campfire: '#70d8ff', copper_bulb: '#ffe0b0' };
  // прозрачное «по альфе» (стекло, листва) — для цветных кубиков
  const CUT_RE = /(_stained_glass|_leaves|tinted_glass|ice_block)$/;
  // ── Bedrock: старые имена с «видом» в состоянии → имя Java ──
  const COLOR_KEY = ['color', 'minecraft:color'];
  function bedrock(name, P){
    const c = COLOR_KEY.map(k => P[k]).find(Boolean), col = c === 'silver' ? 'light_gray' : c;
    const wood = P.wood_type || P.old_log_type || P.new_log_type || P.old_leaf_type || P.new_leaf_type;
    switch (name) {
      case 'wool': case 'concrete': case 'concrete_powder': case 'stained_glass': case 'carpet': case 'shulker_box': return col ? col + '_' + name : 'white_' + name;
      case 'stained_hardened_clay': return (col || 'white') + '_terracotta';
      case 'hardened_clay': return 'terracotta';
      case 'planks': return (wood || 'oak') + '_planks';
      case 'log': case 'log2': return (wood || 'oak') + '_log';
      case 'wood': return (wood || 'oak') + '_wood';
      case 'leaves': case 'leaves2': return (wood || 'oak') + '_leaves';
      case 'sapling': return (P.sapling_type || 'oak') + '_sapling';
      case 'stone': { const t = P.stone_type; return !t || t === 'stone' ? 'stone' : t === 'granite_smooth' ? 'polished_granite' : t === 'diorite_smooth' ? 'polished_diorite' : t === 'andesite_smooth' ? 'polished_andesite' : t; }
      case 'stonebrick': return { default: 'stone_bricks', mossy: 'mossy_stone_bricks', cracked: 'cracked_stone_bricks', chiseled: 'chiseled_stone_bricks' }[P.stone_brick_type] || 'stone_bricks';
      case 'sandstone': return { cut: 'cut_sandstone', heiroglyphs: 'chiseled_sandstone', smooth: 'smooth_sandstone' }[P.sand_stone_type] || 'sandstone';
      case 'red_sandstone': return { cut: 'cut_red_sandstone', heiroglyphs: 'chiseled_red_sandstone', smooth: 'smooth_red_sandstone' }[P.sand_stone_type] || 'red_sandstone';
      case 'quartz_block': return { chiseled: 'chiseled_quartz_block', lines: 'quartz_pillar', smooth: 'smooth_quartz' }[P.chisel_type] || 'quartz_block';
      case 'prismarine': return { bricks: 'prismarine_bricks', dark: 'dark_prismarine' }[P.prismarine_block_type] || 'prismarine';
      case 'sand': return P.sand_type === 'red' ? 'red_sand' : 'sand';
      case 'dirt': return P.dirt_type === 'coarse' ? 'coarse_dirt' : 'dirt';
      case 'grass': return 'grass_block';
      case 'tallgrass': return P.tall_grass_type === 'fern' ? 'fern' : 'short_grass';
      case 'double_plant': return 'tall_grass';
      case 'red_flower': return P.flower_type === 'poppy' || !P.flower_type ? 'poppy' : 'red_tulip';
      case 'yellow_flower': return 'dandelion';
      case 'flowing_water': return 'water';
      case 'flowing_lava': return 'lava';
      case 'lit_furnace': case 'lit_blast_furnace': case 'lit_smoker': return 'furnace';
      case 'lit_redstone_lamp': return 'redstone_lamp';
      case 'lit_pumpkin': return 'jack_o_lantern';
      case 'wooden_door': return 'oak_door';
      case 'brick_block': return 'bricks';
      case 'snow': return 'snow_block';
      case 'snow_layer': return 'snow';
      case 'web': return 'cobweb';
      case 'reeds': return 'sugar_cane';
      case 'waterlily': return 'lily_pad';
      case 'melon_block': return 'melon';
      case 'nether_brick': return 'nether_bricks';
      case 'red_nether_brick': return 'red_nether_bricks';
      case 'end_bricks': return 'end_stone_bricks';
      case 'magma': return 'magma_block';
      case 'slime': return 'slime_block';
      case 'golden_rail': return 'powered_rail';
      case 'monster_egg': return 'infested_stone';
      case 'mob_spawner': return 'spawner';
      case 'invisible_bedrock': return 'barrier';
      case 'stained_glass_pane': return (col || 'white') + '_stained_glass_pane';
      case 'grass_path': return 'dirt_path';
      case 'unlit_redstone_torch': return 'redstone_torch';
      case 'standing_sign': case 'wall_sign': return 'oak_sign';
      case 'coral_block': return 'dead_brain_coral_block';
      default: return name;
    }
  }
  // ── старые числовые id (до 1.13: .schematic MCEdit, миры до 1.13) → имя; данные (data) — вид ──
  const LEG = 'air stone grass_block dirt cobblestone planks sapling bedrock flowing_water water flowing_lava lava sand gravel gold_ore iron_ore coal_ore log leaves sponge glass lapis_ore lapis_block dispenser sandstone note_block bed powered_rail detector_rail sticky_piston cobweb tallgrass dead_bush piston piston_head wool moving_piston dandelion poppy brown_mushroom red_mushroom gold_block iron_block double_stone_slab stone_slab bricks tnt bookshelf mossy_cobblestone obsidian torch fire spawner oak_stairs chest redstone_wire diamond_ore diamond_block crafting_table wheat farmland furnace lit_furnace standing_sign oak_door ladder rail cobblestone_stairs wall_sign lever stone_pressure_plate iron_door oak_pressure_plate redstone_ore lit_redstone_ore unlit_redstone_torch redstone_torch stone_button snow_layer ice snow cactus clay reeds jukebox oak_fence pumpkin netherrack soul_sand glowstone nether_portal lit_pumpkin cake repeater powered_repeater stained_glass oak_trapdoor monster_egg stonebrick brown_mushroom_block red_mushroom_block iron_bars glass_pane melon pumpkin_stem melon_stem vine oak_fence_gate brick_stairs stone_brick_stairs mycelium waterlily nether_brick nether_brick_fence nether_brick_stairs nether_wart enchanting_table brewing_stand cauldron end_portal end_portal_frame end_stone dragon_egg redstone_lamp lit_redstone_lamp double_wooden_slab wooden_slab cocoa sandstone_stairs emerald_ore ender_chest tripwire_hook tripwire emerald_block spruce_stairs birch_stairs jungle_stairs command_block beacon cobblestone_wall flower_pot carrots potatoes oak_button skeleton_skull anvil trapped_chest light_weighted_pressure_plate heavy_weighted_pressure_plate comparator powered_comparator daylight_detector redstone_block nether_quartz_ore hopper quartz_block quartz_stairs activator_rail dropper stained_hardened_clay stained_glass_pane leaves2 log2 acacia_stairs dark_oak_stairs slime_block barrier iron_trapdoor prismarine sea_lantern hay_block carpet hardened_clay coal_block packed_ice double_plant standing_banner wall_banner daylight_detector_inverted red_sandstone red_sandstone_stairs double_stone_slab2 stone_slab2 spruce_fence_gate birch_fence_gate jungle_fence_gate dark_oak_fence_gate acacia_fence_gate spruce_fence birch_fence jungle_fence dark_oak_fence acacia_fence spruce_door birch_door jungle_door acacia_door dark_oak_door end_rod chorus_plant chorus_flower purpur_block purpur_pillar purpur_stairs purpur_double_slab purpur_slab end_bricks beetroots grass_path end_gateway repeating_command_block chain_command_block frosted_ice magma nether_wart_block red_nether_brick bone_block structure_void observer'.split(' ');
  const LEG_COL = DYES.split(' ');
  const WOOD6 = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
  // id, data → имя (Java) + состояние
  MC.legacy = (id, data) => {
    id &= 4095; data &= 15;
    if (id >= 235 && id <= 250) return { name: LEG_COL[id - 235] + '_glazed_terracotta', props: {} };
    if (id === 251) return { name: LEG_COL[data] + '_concrete', props: {} };
    if (id === 252) return { name: LEG_COL[data] + '_concrete_powder', props: {} };
    if (id >= 219 && id <= 234) return { name: LEG_COL[id - 219] + '_shulker_box', props: {} };
    const n = LEG[id]; if (!n) return { name: 'unknown_' + id, props: {} };
    const P = {};
    switch (n) {
      case 'stone': return { name: ['stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite'][data] || 'stone', props: P };
      case 'dirt': return { name: ['dirt', 'coarse_dirt', 'podzol'][data] || 'dirt', props: P };
      case 'planks': case 'double_wooden_slab': case 'wooden_slab': return { name: (WOOD6[data & 7] || 'oak') + '_planks', props: P };
      case 'sapling': return { name: (WOOD6[data & 7] || 'oak') + '_sapling', props: P };
      case 'sand': return { name: data === 1 ? 'red_sand' : 'sand', props: P };
      case 'log': P.axis = ['y', 'x', 'z', 'y'][data >> 2]; return { name: (WOOD6[data & 3] || 'oak') + '_log', props: P };
      case 'log2': P.axis = ['y', 'x', 'z', 'y'][data >> 2]; return { name: (WOOD6[4 + (data & 1)]) + '_log', props: P };
      case 'leaves': return { name: (WOOD6[data & 3] || 'oak') + '_leaves', props: P };
      case 'leaves2': return { name: WOOD6[4 + (data & 1)] + '_leaves', props: P };
      case 'tallgrass': return { name: data === 2 ? 'fern' : data === 0 ? 'dead_bush' : 'short_grass', props: P };
      case 'wool': case 'carpet': case 'stained_glass': case 'stained_glass_pane': return { name: LEG_COL[data] + '_' + n, props: P };
      case 'stained_hardened_clay': return { name: LEG_COL[data] + '_terracotta', props: P };
      case 'hardened_clay': return { name: 'terracotta', props: P };
      case 'stonebrick': return { name: ['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks'][data & 3], props: P };
      case 'prismarine': return { name: ['prismarine', 'prismarine_bricks', 'dark_prismarine'][data] || 'prismarine', props: P };
      case 'sandstone': return { name: ['sandstone', 'chiseled_sandstone', 'cut_sandstone'][data] || 'sandstone', props: P };
      case 'red_sandstone': return { name: ['red_sandstone', 'chiseled_red_sandstone', 'cut_red_sandstone'][data] || 'red_sandstone', props: P };
      case 'quartz_block': return { name: ['quartz_block', 'chiseled_quartz_block', 'quartz_pillar', 'quartz_pillar', 'quartz_pillar'][data] || 'quartz_block', props: P };
      case 'double_stone_slab': case 'stone_slab': return { name: ['smooth_stone', 'sandstone', 'oak_planks', 'cobblestone', 'bricks', 'stone_bricks', 'nether_bricks', 'quartz_block'][data & 7], props: P };
      case 'water': case 'lava': case 'flowing_water': case 'flowing_lava': P.level = String(n.startsWith('flowing') ? data || 1 : data); return { name: n.replace('flowing_', ''), props: P };
      case 'torch': case 'redstone_torch': case 'unlit_redstone_torch': {
        const f = { 1: 'east', 2: 'west', 3: 'south', 4: 'north' }[data];
        return f ? { name: 'wall_torch', props: { facing: f } } : { name: 'torch', props: P };
      }
      case 'chest': case 'trapped_chest': case 'furnace': case 'lit_furnace': case 'ladder': case 'ender_chest': {
        const f = { 2: 'north', 3: 'south', 4: 'west', 5: 'east' }[data] || 'north';
        return { name: n === 'lit_furnace' ? 'furnace' : n, props: { facing: f, lit: n === 'lit_furnace' ? 'true' : undefined } };
      }
      case 'oak_door': case 'iron_door': case 'spruce_door': case 'birch_door': case 'jungle_door': case 'acacia_door': case 'dark_oak_door': {
        if (data & 8) return { name: n, props: { half: 'upper' } };
        return { name: n, props: { half: 'lower', facing: ['east', 'south', 'west', 'north'][data & 3], open: data & 4 ? 'true' : 'false' } };
      }
      case 'lit_redstone_lamp': return { name: 'redstone_lamp', props: { lit: 'true' } };
      case 'lit_pumpkin': return { name: 'jack_o_lantern', props: P };
      case 'snow': return { name: 'snow_block', props: P };
      case 'snow_layer': return { name: 'snow', props: P };
      case 'reeds': return { name: 'sugar_cane', props: P };
      case 'melon': return { name: 'melon', props: P };
      case 'nether_brick': return { name: 'nether_bricks', props: P };
      case 'red_nether_brick': return { name: 'red_nether_bricks', props: P };
      case 'magma': return { name: 'magma_block', props: P };
      case 'grass_path': return { name: 'dirt_path', props: P };
      case 'end_bricks': return { name: 'end_stone_bricks', props: P };
      case 'waterlily': return { name: 'lily_pad', props: P };
      case 'monster_egg': return { name: 'infested_stone', props: P };
      default: return { name: n, props: P };
    }
  };

  // ── состояние → наше (ось бревна, сторона факела/лестницы/печи/сундука, дверь) ──
  // наши стороны (как V.FACING): 0 +z (юг), 1 −x (запад), 2 −z (север), 3 +x (восток)
  const SIDE = { south: 0, west: 1, north: 2, east: 3 };
  const BSIDE = [3, 0, 2, 1];   // Bedrock direction 0 юг, 1 запад, 2 север, 3 восток → наша
  const facingOf = P => {
    if (P.facing && SIDE[P.facing] !== undefined) return SIDE[P.facing];
    const c = P['minecraft:cardinal_direction'] || P.torch_facing_direction; if (c && SIDE[c] !== undefined) return SIDE[c];
    if (P.facing_direction != null) { const f = +P.facing_direction; return f === 2 ? 2 : f === 3 ? 0 : f === 4 ? 1 : f === 5 ? 3 : -1; }
    if (P.direction != null) { const d = +P.direction; return [0, 1, 2, 3][d] ?? -1; }
    return -1;
  };
  const OPP = [2, 3, 0, 1];
  function stateOf(rule, P){
    switch (rule) {
      case 'axis': { const a = P.axis || P.pillar_axis; return a === 'x' ? 1 : a === 'z' ? 2 : 0; }
      case 'walltorch': { const f = facingOf(P); return f >= 0 ? 1 + f : 0; }
      case 'ladder': { const f = facingOf(P); return f >= 0 ? f : 0; }
      case 'facing': case 'furnace': { const f = facingOf(P); return f >= 0 ? f : 0; }
      case 'door': {
        const upper = P.half === 'upper' || P.upper_block_bit === 'true' || P.upper_block_bit === '1' || P.upper_block_bit === true;
        const f = facingOf(P), open = P.open === 'true' || P.open_bit === 'true' || P.open_bit === '1' || P.open_bit === true;
        return (f >= 0 ? OPP[f] : 0) | (open ? 4 : 0) | (upper ? 8 : 0);
      }
      default: return 0;
    }
  }

  // ── главное: строка состояния → наш блок ──
  const extra = Object.create(null);   // MC.extend — от модов
  MC.extend = map => { let n = 0; for (const [k, v] of Object.entries(map || {})) { const key = String(k).replace(/^minecraft:/, ''); if (typeof v === 'string' && v) { extra[key] = v; n++; } } return n; };
  MC.color = n => COL[n] || null;
  MC.emitOf = n => EMIT[n] || 0;
  MC.lightColor = n => LCOL[n] || null;
  MC.cutout = n => CUT_RE.test(n);
  const STRIP = /(_stairs|_slab|_wall|_fence_gate|_fence|_double_slab)$/;
  // материал «ступенек, плит, стен, заборов»: oak_stairs → oak_planks, stone_brick_wall → stone_bricks, quartz_slab → quartz_block
  function baseOf(n){
    const b = n.replace(STRIP, '');
    if (b === n) return null;
    for (const c of [b, b + 's', b + '_planks', b + '_block', b.replace(/^(waxed_)/, ''), b === 'smooth_stone' ? 'smooth_stone' : '', b === 'petrified_oak' ? 'oak_planks' : '', b.replace(/_brick$/, '_bricks')])
      if (c && (B[c] || COL[c] || extra[c])) return c;
    return null;
  }
  MC.resolve = (stateStr, o = {}) => {
    let { ns, name, props } = typeof stateStr === 'string' ? MC.parseState(stateStr) : stateStr;
    if (ns !== 'minecraft') {
      const full = ns + ':' + name;
      if (extra[full]) return { name: extra[full], st: 0 };
      return o.mods && o.mods.has(full) ? { name: full, st: 0 } : { name: 'missing', st: 0, unknown: true, mc: full };
    }
    if (o.bedrock) name = bedrock(name, props);
    name = name.replace(/^waxed_/, '');
    if (extra[name]) return { name: extra[name], st: 0 };
    // вода и лава: только источники (течение «Кубомир» посчитает сам)
    if (name === 'water' || name === 'lava') { const lv = +(props.level ?? props.liquid_depth ?? 0); return lv > 0 ? { name: 'air', st: 0, flow: true } : { name, st: 0 }; }
    if (props.waterlogged === 'true' && THIN.has(name)) return { name: 'water', st: 0 };
    const d = B[name];
    if (d) {
      if (typeof d === 'string') return d === 'lamp' && name === 'redstone_lamp' && props.lit !== 'true' ? { name: 'mc:redstone_lamp', st: 0, color: '#5f3a22' } : { name: d, st: 0 };
      if (d.r === 'door' && (props.half === 'upper' || props.upper_block_bit === 'true' || props.upper_block_bit === true || props.upper_block_bit === '1')) return { name: d.b, st: stateOf('door', props) };
      if (d.r === 'lamp') return props.lit === 'true' ? { name: 'lamp', st: 0 } : { name: 'mc:redstone_lamp', st: 0, color: '#5f3a22' };
      if (d.r === 'furnace') return { name: props.lit === 'true' ? 'furnace_lit' : d.b, st: stateOf('furnace', props) };
      return { name: d.b, st: stateOf(d.r, props) };
    }
    if (THIN.has(name) || THIN_RE.test(name)) {
      if (props.waterlogged === 'true') return { name: 'water', st: 0 };
      return { name: 'air', st: 0, thin: true };
    }
    // ступени, плиты, стены, заборы — материалом
    const base = baseOf(name);
    if (base) { const r = MC.resolve('minecraft:' + base, o); return Object.assign({}, r, { approx: true }); }
    if (COL[name]) return { name: 'mc:' + name, st: name.endsWith('_log') || name.endsWith('_wood') || name.endsWith('_stem') || name.endsWith('_hyphae') || name.endsWith('_pillar') || name === 'bamboo_block' ? stateOf('axis', props) : 0, color: COL[name] };
    return { name: 'missing', st: 0, unknown: true, mc: name };
  };
  // описание цветного блока «mc:имя» для реестра (kubomir: V.mc.blockDefs) — без картинок Mojang
  MC.blockDef = name => {
    const n = name.replace(/^mc:/, ''), c = COL[n] || '#888888', e = EMIT[n] || 0;
    const pillar = /(_log|_wood|_stem|_hyphae|_pillar|bamboo_block|hay_block|bone_block|basalt)$/.test(n);
    const cut = CUT_RE.test(n), leaves = /_leaves$/.test(n), glass = /glass$/.test(n);
    const ore = /_ore$/.test(n);
    return { name: 'mc:' + n, color: c, emit: e, lcol: LCOL[n] || null, cut, leaves, glass, pillar, ore,
      sound: /wool|carpet/.test(n) ? 'wool' : /glass|ice|amethyst/.test(n) ? 'glass' : /planks|_log|_wood|_stem|bookshelf|barrel|chest|table/.test(n) ? 'wood' : /sand|gravel|dirt|mud|soul|powder/.test(n) ? 'sand' : leaves || /moss|grass|hay|nylium|wart|sponge/.test(n) ? 'grass' : /copper|iron|gold|netherite|anvil|block$/.test(n) && !/stone|snow|mud/.test(n) ? 'metal' : /snow/.test(n) ? 'snow' : 'stone',
      hard: leaves ? .2 : glass || cut ? .3 : /wool/.test(n) ? .8 : /planks|_log|_wood/.test(n) ? 2 : /sand|gravel|dirt|mud|soul|powder|hay/.test(n) ? .6 : ore ? 3 : /obsidian|netherite|ancient/.test(n) ? 30 : 1.5,
      tool: leaves ? '' : /planks|_log|_wood|_stem|bookshelf|barrel|chest|table|pumpkin|melon/.test(n) ? 'axe' : /sand|gravel|dirt|mud|soul|powder|snow|clay/.test(n) ? 'shovel' : /wool/.test(n) ? '' : 'pick' };
  };

  // ── предметы (рецепты, моды, пакеты данных): имя Minecraft → наше ──
  const I = { stick: 'stick', coal: 'coal', charcoal: 'coal', iron_ingot: 'iron_ingot', gold_ingot: 'gold_ingot', diamond: 'diamond', clay_ball: 'clay_ball', brick: 'brick',
    apple: 'apple', beef: 'meat_raw', porkchop: 'meat_raw', mutton: 'meat_raw', rabbit: 'meat_raw', cooked_beef: 'meat_cooked', cooked_porkchop: 'meat_cooked', cooked_mutton: 'meat_cooked',
    cooked_rabbit: 'meat_cooked', chicken: 'chicken_raw', cooked_chicken: 'chicken_cooked', feather: 'feather', slime_ball: 'slime_ball',
    wooden_pickaxe: 'pick_wood', wooden_axe: 'axe_wood', wooden_shovel: 'shovel_wood', wooden_sword: 'sword_wood',
    stone_pickaxe: 'pick_stone', stone_axe: 'axe_stone', stone_shovel: 'shovel_stone', stone_sword: 'sword_stone',
    iron_pickaxe: 'pick_iron', iron_axe: 'axe_iron', iron_shovel: 'shovel_iron', iron_sword: 'sword_iron',
    golden_pickaxe: 'pick_gold', golden_axe: 'axe_gold', golden_shovel: 'shovel_gold', golden_sword: 'sword_gold',
    diamond_pickaxe: 'pick_diamond', diamond_axe: 'axe_diamond', diamond_shovel: 'shovel_diamond', diamond_sword: 'sword_diamond',
    netherite_pickaxe: 'pick_diamond', netherite_axe: 'axe_diamond', netherite_shovel: 'shovel_diamond', netherite_sword: 'sword_diamond',
    oak_door: 'door', iron_door: 'door', spruce_door: 'door', birch_door: 'door' };
  MC.item = (n, o = {}) => {
    let s = String(n || ''); const c = s.indexOf(':'), ns = c >= 0 ? s.slice(0, c) : 'minecraft'; s = c >= 0 ? s.slice(c + 1) : s;
    if (ns !== 'minecraft') return o.mods && o.mods.has(ns + ':' + s) ? ns + ':' + s : null;
    if (I[s]) return I[s];
    const r = MC.resolve('minecraft:' + s, o);
    if (r.name && r.name !== 'air' && r.name !== 'missing' && !r.approx && !r.name.startsWith('mc:')) return r.name;
    return null;
  };
  // группы (теги) → наша группа или предмет
  const TAGS = { planks: '#planks', logs: '#log', logs_that_burn: '#log', oak_logs: '#log', birch_logs: '#log', spruce_logs: '#log', coals: '#coal',
    'ingots/iron': 'iron_ingot', 'ingots/gold': 'gold_ingot', 'gems/diamond': 'diamond', 'rods/wooden': 'stick', stone_tool_materials: 'cobble', stone_crafting_materials: 'cobble',
    cobblestone: 'cobble', cobblestones: 'cobble', 'cobblestones/normal': 'cobble', sand: 'sand', 'sands': 'sand', glass: 'glass', glass_blocks: 'glass', 'glass_blocks/colorless': 'glass',
    leaves: 'leaves_oak', 'chests/wooden': 'chest', chests: 'chest', 'stones': 'stone', stone: 'stone', 'storage_blocks/iron': 'iron_block', 'storage_blocks/gold': 'gold_block', 'storage_blocks/diamond': 'diamond_block',
    'ores/iron': 'ore_iron', 'ores/gold': 'ore_gold', 'ores/coal': 'ore_coal', 'ores/diamond': 'ore_diamond', wool: null, wooden_slabs: null };
  MC.tag = t => {
    const s = String(t || '').replace(/^#/, ''), c = s.indexOf(':'), k = c >= 0 ? s.slice(c + 1) : s;
    return Object.prototype.hasOwnProperty.call(TAGS, k) ? TAGS[k] : null;
  };
  // для отчёта и тестов
  MC._tables = { B, COL, EMIT, THIN, LEG };
})();
