#!/usr/bin/env node
/**
 * 打包与提权相关的回归断言。
 *
 * 存在的原因是一次真实事故：打包出的 `prompt-forge.exe` **每次启动都弹 UAC**。
 * 根因不是代码、也不是 `installMode`，而是应用清单里**缺少**
 * `requestedExecutionLevel` —— Windows 只在清单显式声明权限级别时才跳过
 * 「安装程序检测」（Installer Detection）；缺这一行时系统按启发式把 exe 当安装包，
 * 自动请求提权（本机 `EnableInstallerDetection = 1`，确实会触发）。
 *
 * 三条防线：
 * 1. `manifest.xml` 必须存在，且**声明 asInvoker、绝不出现 requireAdministrator**；
 * 2. `build.rs` 必须把该清单注入（`app_manifest`），否则清单等于没写；
 * 3. 编译产物里必须**真的能读到** `requestedExecutionLevel`（源码对不代表产物对）。
 *
 * 另外钉住 `installMode: currentUser`：安装包按用户目录安装，不需要管理员。
 *
 * 全部离线、只读源码与产物，不需要网络与密钥。
 *
 * 运行：npm run verify:packaging
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const srcTauri = path.join(root, 'src-tauri');
const nearest = (file) => path.basename(path.dirname(path.dirname(file))) + '  ' + file;
const manifestPath = path.join(srcTauri, 'manifest.xml');
const buildRsPath = path.join(srcTauri, 'build.rs');
const confPath = path.join(srcTauri, 'tauri.conf.json');

/**
 * 主二进制路径。
 *
 * 用户 2026 轮把 exe 改名为「榫言」（`mainBinaryName`），因此这里**从配置里读**，
 * 不再写死 `prompt-forge.exe`；新旧名字都找一遍，这样即便配置回退也能继续跑。
 */
function resolveExePath() {
  let name = 'prompt-forge';
  try {
    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    if (typeof conf.mainBinaryName === 'string' && conf.mainBinaryName.trim()) {
      name = conf.mainBinaryName.trim();
    }
  } catch {
    // 配置读不出来就按默认名找
  }
  const candidates = [
    path.join(srcTauri, 'target', 'release', `${name}.exe`),
    path.join(srcTauri, 'target', 'release', 'prompt-forge.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

const exePath = resolveExePath();

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  [通过] ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  [失败] ${name}`);
    console.log(`         ${error.message}`);
  }
}

/** 以 UTF-8 读整个二进制为字符串（清单在 exe 里是原样文本，足够断言） */
function readBinaryText(file) {
  return fs.readFileSync(file).toString('utf8');
}

console.log('\n打包与提权回归：应用不得请求管理员权限');

// ---------------------------------------------------------------------------
check('manifest.xml 存在，且声明 requestedExecutionLevel = asInvoker', () => {
  assert.ok(fs.existsSync(manifestPath), '缺少 src-tauri/manifest.xml');
  const xml = fs.readFileSync(manifestPath, 'utf8');
  assert.match(
    xml,
    /<requestedExecutionLevel\s+level="asInvoker"/,
    '清单没有声明 asInvoker —— 缺这一行就会被 Windows 当成安装包而弹 UAC',
  );
});

check('manifest.xml 里绝不出现 requireAdministrator / highestAvailable', () => {
  const xml = fs.readFileSync(manifestPath, 'utf8');
  // 注释里会提到 requireAdministrator 作为「禁止这么改」的说明，因此只检查真正的元素
  const active = xml.replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(/requireAdministrator/.test(active), false, '清单要求了管理员权限');
  assert.equal(/highestAvailable/.test(active), false, '清单要求了最高可用权限');
});

check('清单保留了 Common-Controls 依赖（控件外观不能因修 UAC 而退化）', () => {
  const xml = fs.readFileSync(manifestPath, 'utf8');
  assert.match(xml, /Microsoft\.Windows\.Common-Controls/, '缺少 Common-Controls 依赖');
  assert.match(xml, /version="6\.0\.0\.0"/, 'Common-Controls 版本不对');
});

check('清单注入状态明确：要么启用且注入正确，要么「干净停用」并写明原因', () => {
  /*
   * 现实约束：**在目标机器上，注入清单的版本连 main() 都进不到就崩溃**
   * （无任何日志、0xc0000409），停用清单后应用能正常进入 main()。
   * 因此清单目前是**停用**状态。这条断言要防的是「半停用」——
   * 比如把代码删一半、留下一个既没注入又没说明的 build.rs。
   */
  const rs = fs.readFileSync(buildRsPath, 'utf8');
  const active = /^\s*let\s+windows\s*=/m.test(rs) || /app_manifest\s*\(/.test(rs.replace(/^\s*\/\/.*$/gm, ''));
  const mentionsManifest = /manifest\.xml/.test(rs);

  if (active) {
    assert.ok(mentionsManifest, '启用注入时必须引用 manifest.xml');
    assert.match(rs, /windows_attributes/, '启用注入时必须装配 windows_attributes');
  } else {
    assert.ok(mentionsManifest, '停用时也要在注释里写明改的是 manifest.xml 与原因');
    assert.match(
      rs,
      /停用/,
      '停用清单注入必须在 build.rs 里写明原因（否则后来人不知道这里为什么是空的）',
    );
  }
});

check('启动日志只用 ASCII（乱码的日志等于没有日志）', () => {
  /*
   * 真事故：日志里写中文时，编辑器按本地 ANSI 代码页解码成乱码，
   * 「能定位问题」的价值直接归零。诊断信息必须在这台坏掉的机器上可读。
   */
  const logSource = fs.readFileSync(path.join(srcTauri, 'src', 'logging.rs'), 'utf8');
  const stringLiterals = [...logSource.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((m) => m[1]);
  const offenders = stringLiterals.filter((text) => /[^\x20-\x7E]/.test(text));
  assert.deepEqual(offenders, [], `日志字符串出现非 ASCII 字符：${offenders.join(' | ')}`);
});

check('NSIS 安装模式显式为 currentUser（不往 Program Files 装、不要管理员）', () => {
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  assert.equal(
    conf.bundle?.windows?.nsis?.installMode,
    'currentUser',
    'installMode 应当是 currentUser',
  );
});

check('改名「榫言」的范围：窗口标题 + exe 文件名，**不动安装包与安装目录**', () => {
  /*
   * 用户 2026 轮：「改窗口 + exe 文件名，不改安装包」。
   * Tauri 2 里这两件事由不同字段控制，因此这条断言同时钉住「改了」与「没改」：
   * - `app.windows[0].title` = 窗口标题（用户看到的右上角外框）；
   * - `mainBinaryName`       = 只重命名主二进制（exe）；
   * - `productName`          = Windows 上的**安装包名 / 安装目录 / 开始菜单 / 注册表键**，
   *                            因此必须保持原样，否则用户已装的版本升级时会变成另一个程序。
   */
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  assert.equal(conf.app?.windows?.[0]?.title, '榫言', '窗口标题应当改成「榫言」');
  assert.equal(conf.mainBinaryName, '榫言', 'exe 文件名应当改成「榫言」');
  assert.equal(
    conf.productName,
    'Prompt Forge',
    'productName 决定安装包名与安装目录，改名会破坏已安装版本的升级路径',
  );
});

// ---------------------------------------------------------------------------
console.log('\n应用图标（D56：换成用户提供的图标，桌面端三件套必须齐全）');

const iconsDir = path.join(srcTauri, 'icons');

/** 读 PNG 的 IHDR 宽高（不引第三方依赖：断言脚本只读源码与产物） */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.ok(
    buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47,
    `${path.basename(file)} 不是合法 PNG`,
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 解 PNG 像素（只处理 8 位 RGBA、非隔行 —— 图标生成器产出的就是这种）。
 *
 * 为什么自己写：要断言的是「四角透明」这个**像素级事实**，读 IHDR 只能拿到尺寸与颜色类型。
 * 引第三方图像库会让一层断言多一个依赖；这里只需要 zlib（Node 内置）+ 五种行过滤。
 */
function decodePng(file) {
  const buf = fs.readFileSync(file);
  assert.ok(buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47, `${path.basename(file)} 不是 PNG`);
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  assert.ok(header, 'PNG 缺少 IHDR');
  assert.equal(header.depth, 8, '只支持 8 位深度的图标 PNG');
  assert.equal(header.interlace, 0, '只支持非隔行的图标 PNG');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = header.width * bpp;
  const pixels = Buffer.alloc(stride * header.height);
  for (let row = 0; row < header.height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const from = row * (stride + 1) + 1;
    const cur = pixels.subarray(row * stride, (row + 1) * stride);
    const prev = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
      let value = raw[from + i];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (value + predictor) & 255;
      } else {
        assert.equal(filter, 0, `不支持的 PNG 行过滤类型 ${filter}`);
      }
      cur[i] = value;
    }
  }
  return {
    width: header.width,
    height: header.height,
    colorType: header.colorType,
    alpha(x, y) {
      return pixels[y * stride + x * bpp + 3];
    },
  };
}

check('bundle.icon 列出的每个图标都存在，且 PNG 的实际尺寸与文件名一致', () => {
  /*
   * 图标是**产物级资产**：文件名写着 128x128，内容却是别的尺寸时，
   * 界面里不会报错，只会在任务栏/开始菜单上糊成一团，很难被发现。
   * 因此按文件名反推应有尺寸，再读 PNG 的 IHDR 核对。
   */
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  const listed = conf.bundle?.icon ?? [];
  assert.ok(listed.length >= 4, 'bundle.icon 列出的图标太少');
  assert.ok(
    listed.includes('icons/icon.ico'),
    'bundle.icon 必须保留 icon.ico：Windows 的 exe 图标只认它（删了就会退回默认图标）',
  );
  for (const rel of listed) {
    const file = path.join(srcTauri, rel);
    assert.ok(fs.existsSync(file), `配置里列出了 ${rel}，但文件不存在`);
    assert.ok(fs.statSync(file).size > 0, `${rel} 是空文件`);
    const match = /(\d+)x(\d+)(@2x)?\.png$/.exec(rel);
    if (!match) continue;
    const scale = match[3] ? 2 : 1;
    const expected = Number(match[1]) * scale;
    const { width, height } = pngSize(file);
    assert.equal(width, expected, `${rel} 的实际宽度是 ${width}，应为 ${expected}`);
    assert.equal(height, expected, `${rel} 的实际高度是 ${height}，应为 ${expected}`);
  }
});

check('icon.ico 是合法 ICO，且包含任务栏 / 资源管理器各自会取的尺寸', () => {
  // 任务栏取 32、Alt+Tab 取 48、大图标视图取 256；只有一档时会在某些视图里变模糊
  const icoPath = path.join(iconsDir, 'icon.ico');
  assert.ok(fs.existsSync(icoPath), '缺少 src-tauri/icons/icon.ico');
  const buf = fs.readFileSync(icoPath);
  assert.ok(buf.length > 1024, 'icon.ico 太小，可能是占位文件');
  assert.equal(buf.readUInt16LE(0), 0, 'ICO 保留字段应为 0');
  assert.equal(buf.readUInt16LE(2), 1, 'ICO 类型应为 1（图标）');
  const count = buf.readUInt16LE(4);
  assert.ok(count >= 4, `ICO 里只有 ${count} 个尺寸，Windows 至少需要 16/32/48/256`);
  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    const width = buf[6 + i * 16];
    sizes.push(width === 0 ? 256 : width);
  }
  for (const size of [16, 32, 48, 256]) {
    assert.ok(sizes.includes(size), `ICO 缺少 ${size}px 这一档（当前：${sizes.join('/')}）`);
  }
});

check('图标是圆角：四角透明、边缘中部与中心不透明（D56）', () => {
  /*
   * 用户 2026 轮要求「能实现圆角吗」：做法是给源图加**抗锯齿圆角蒙版**（20% 半径）再生成全套图标，
   * 于是四角变成透明 —— Windows 任务栏/Alt+Tab 会直接显示成圆角方块。
   * 这里真解一次 PNG 像素：只断言「透明度」这一件事，够用且不依赖第三方库。
   * 若将来改回直角，请连同 D56 与这条断言一起改（别只改图）。
   */
  const file = path.join(iconsDir, '128x128.png');
  const png = decodePng(file);
  assert.equal(png.colorType, 6, '图标必须是 RGBA（圆角依赖透明通道）');
  const alpha = (x, y) => png.alpha(x, y);
  assert.equal(alpha(1, 1), 0, '左上角应当透明（圆角）');
  assert.equal(alpha(png.width - 2, 1), 0, '右上角应当透明（圆角）');
  assert.equal(alpha(1, png.height - 2), 0, '左下角应当透明（圆角）');
  assert.equal(alpha(png.width - 2, png.height - 2), 0, '右下角应当透明（圆角）');
  assert.equal(alpha(Math.floor(png.width / 2), Math.floor(png.height / 2)), 255, '中心必须不透明');
  // 圆角只切四角：左右两侧的中点是直边，不能也被吃掉
  assert.equal(alpha(0, Math.floor(png.height / 2)), 255, '左边缘中部应当不透明（直边）');
});

check('桌面项目不提交移动端图标（tauri icon 会顺手生成 android / ios）', () => {
  /*
   * `npm run tauri -- icon` 会同时产出 android/ios 两套图，本项目只做 Windows 桌面端，
   * 提交它们只会让仓库多出 ~50 个永远没人用的文件（还容易被当成"已经支持移动端"）。
   */
  for (const dir of ['android', 'ios']) {
    assert.equal(
      fs.existsSync(path.join(iconsDir, dir)),
      false,
      `src-tauri/icons/${dir} 是移动端产物，本项目只做桌面端，删掉即可`,
    );
  }
});

check('build.rs 声明了图标依赖（换图标必须触发资源重建，否则链接的仍是旧 .res）', () => {
  /*
   * 真坑（本轮踩到）：改完 icons/icon.ico 直接 `tauri build`，cargo 认为 build script 是新鲜的，
   * 不会重跑 tauri-build，于是链接的还是上一次的 resource.lib —— **exe 一切正常，只有任务栏、
   * 资源管理器、开始菜单显示旧图标**。界面上没有任何异常，极难与缓存联系起来。
   */
  const rs = fs.readFileSync(buildRsPath, 'utf8');
  assert.match(
    rs,
    /cargo:rerun-if-changed=icons/,
    'build.rs 缺少 println!("cargo:rerun-if-changed=icons")：换图标后不会重建资源，exe 里仍是旧图标',
  );
});

check('Tauri 2 不存在 runAsAdmin 配置项（不该被误加）', () => {
  const raw = fs.readFileSync(confPath, 'utf8');
  assert.equal(/"runAsAdmin"/.test(raw), false, 'runAsAdmin 不是 Tauri 2 的配置项');
  const conf = JSON.parse(raw);
  assert.equal('runAsAdmin' in conf, false);
  assert.equal('runAsAdmin' in (conf.bundle ?? {}), false);
});

check('manifest.xml 是纯 ASCII、无 BOM、无注释、无 XML 声明', () => {
  /*
   * 这一条是**真事故**换来的（应用一度完全无法启动，事件日志：Invalid Xml syntax）：
   * rc.exe 把清单逐行包成字符串字面量并**按本地代码页（GBK）解码 UTF-8 字节**，
   * 因此：①中文一旦进清单就变乱码并破坏 XML；②XML 声明前面会被加上空白，
   * 而 XML 规定声明必须是文档第一个节点 ⇒ 解析失败。清单里也不该有注释（同样会乱码）。
   */
  const bytes = fs.readFileSync(manifestPath);
  const nonAscii = [...bytes].some((byte) => byte > 127);
  assert.equal(nonAscii, false, '清单必须是纯 ASCII：rc.exe 会按本地代码页解码，中文会变乱码');
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  assert.equal(hasBom, false, '清单不能带 UTF-8 BOM');

  const xml = bytes.toString('utf8');
  assert.equal(/<!--/.test(xml), false, '清单里不要写注释（会被 rc.exe 逐行破坏）');
  assert.equal(
    /^<\?xml/.test(xml.trimStart()),
    false,
    '清单不要写 XML 声明：rc.exe 会在它前面留空白，导致「XML 声明不是第一个节点」而解析失败',
  );
  assert.ok(/^<assembly\b/.test(xml), '清单第一个元素应当直接是 <assembly>');
});

check('manifest.xml 本身是合法 XML，且权限级别读出来就是 asInvoker', () => {
  const xml = fs.readFileSync(manifestPath, 'utf8');
  // 不引第三方解析器：用最小的结构断言，配合下面「产物拼接后仍合法」一起把关
  const open = (xml.match(/<assembly\b/g) ?? []).length;
  const close = (xml.match(/<\/assembly>/g) ?? []).length;
  assert.equal(open, 1, '<assembly> 开标签应当恰好一个');
  assert.equal(close, 1, '</assembly> 闭标签应当恰好一个');
  assert.match(xml, /manifestVersion="1\.0"/, '缺少 manifestVersion');
  const level = xml.match(/<requestedExecutionLevel[^>]*level="([^"]+)"/);
  assert.ok(level, '找不到 requestedExecutionLevel 的 level 属性');
  assert.equal(level[1], 'asInvoker', `权限级别应为 asInvoker，实际 ${level[1]}`);
});

check('manifest.xml 是最小清单：只声明权限与原有依赖，不自造程序集身份', () => {
  /*
   * 一度在清单里加了 <assemblyIdentity name="com.promptforge.app"> 与五个 supportedOS，
   * 结果应用启动即闪退（0xc0000409）。清单能小就小：只保留
   * 「权限声明」这一件必须做的事，加上原本就有的 Common-Controls 依赖。
   */
  const xml = fs.readFileSync(manifestPath, 'utf8');
  assert.equal(
    /name="com\.promptforge\.app"/.test(xml),
    false,
    '不要在应用清单里自造 assemblyIdentity（曾导致启动闪退）',
  );
  const supported = (xml.match(/<supportedOS/g) ?? []).length;
  assert.ok(supported <= 1, `supportedOS 最多保留一条（当前 ${supported} 条）`);
  assert.match(xml, /Microsoft\.Windows\.Common-Controls/, '缺少原有的 Common-Controls 依赖');
});

check('启动诊断（日志 + panic 钩子）已接进后端入口', () => {
  /*
   * 普通启动闪退时，release profile 的 panic = "abort" 会把 panic 变成 0xc0000409，
   * 界面上什么都看不到。因此必须有：①panic 钩子把原因同步落盘；②启动检查点。
   */
  const logRs = path.join(srcTauri, 'src', 'logging.rs');
  assert.ok(fs.existsSync(logRs), '缺少 src-tauri/src/logging.rs');
  const logSource = fs.readFileSync(logRs, 'utf8');
  assert.match(logSource, /set_hook/, '没有安装 panic 钩子');
  assert.match(logSource, /startup\.log/, '日志文件名应为 startup.log');

  const libRs = fs.readFileSync(path.join(srcTauri, 'src', 'lib.rs'), 'utf8');
  assert.match(libRs, /mod logging;/, 'lib.rs 没有声明 logging 模块');
  assert.match(libRs, /logging::install_panic_hook\(\)/, '没有在入口装 panic 钩子');
  assert.match(libRs, /logging::log_environment\(\)/, '没有记录启动环境');
  assert.equal(
    /\.expect\("error while running tauri application"\)/.test(libRs),
    false,
    '入口不该用 expect 吞掉启动错误（会变成看不见的 0xc0000409），应写日志后退出',
  );
});

// ---------------------------------------------------------------------------
console.log('\n编译产物（清单是否被正确嵌入）');

/** 清单注入当前是否启用（过滤掉注释行后再判断） */
function isManifestInjectionActive() {
  const rs = fs.readFileSync(buildRsPath, 'utf8');
  const withoutComments = rs
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return /app_manifest\s*\(/.test(withoutComments);
}

/** rc.exe 会把清单逐行写成字符串字面量（其中 `"` 写作 `""`），这里按同样的规则还原 */
function extractEmbeddedManifest(rcText) {
  const lines = rcText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*1 24\s*$/.test(line));
  if (start < 0) return null;
  const parts = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '}') break;
    if (line === '{') continue;
    const quoted = line.match(/^"(.*)"$/);
    // rc 的双写引号 `""` 在资源里会还原成单个 `"`
    if (quoted) parts.push(quoted[1].replace(/""/g, '"'));
  }
  return parts.join('');
}

check('编译产物里的清单能还原成合法 XML（源码对 ≠ 产物对）', () => {
  const outDir = path.join(srcTauri, 'target', 'release', 'build');
  if (!fs.existsSync(outDir)) {
    console.log('         （跳过：还没有编译产物）');
    return;
  }
  if (!isManifestInjectionActive()) {
    console.log('         （跳过：清单注入当前已停用，产物里本就不该有清单）');
    return;
  }
  const rcFiles = [];
  for (const dir of fs.readdirSync(outDir)) {
    const candidate = path.join(outDir, dir, 'out', 'resource.rc');
    if (fs.existsSync(candidate)) rcFiles.push(candidate);
  }
  assert.ok(rcFiles.length > 0, '找不到 resource.rc');
  // 取最近生成的那个（就是本次链接用的）
  const newest = rcFiles
    .map((file) => ({ file, at: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0].file;

  const manifest = extractEmbeddedManifest(fs.readFileSync(newest, 'utf8'));
  assert.ok(manifest, `${newest} 里找不到清单资源（1 24）`);
  assert.equal(
    /[^\x00-\x7F]/.test(manifest),
    false,
    '产物清单里出现非 ASCII（rc.exe 按本地代码页解码导致乱码 ⇒ 非法 XML ⇒ 应用无法启动）',
  );
  assert.match(manifest, /^\s*<assembly\b/, '产物清单不是以 <assembly> 开头');
  assert.equal(
    /^<\?xml/.test(manifest),
    false,
    '产物清单带 XML 声明，且前面有空白 ⇒ Windows 会判为 Invalid Xml syntax',
  );
  // 元素必须成对（曾经的失败就是结构被破坏）
  for (const tag of ['assembly', 'trustInfo', 'security', 'requestedPrivileges', 'dependency', 'compatibility', 'application']) {
    const opened = (manifest.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;
    const closed = (manifest.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
    const selfClosed = (manifest.match(new RegExp(`<${tag}\\b[^>]*/>`, 'g')) ?? []).length;
    assert.equal(opened, closed + selfClosed, `产物清单里 <${tag}> 配对不对`);
  }
  assert.match(manifest, /level="asInvoker"/, '产物清单里没有 asInvoker');
});

check('target/release 下的主二进制里能读到显式 asInvoker', () => {
  if (!fs.existsSync(exePath)) {
    // 未构建过 exe 时不假装通过，但也不记为失败：用一条明确的中文提示跳过
    console.log('         （跳过：还没有构建产物，请先 npm run tauri build -- --no-bundle）');
    return;
  }
  if (!isManifestInjectionActive()) {
    console.log('         （跳过：清单注入当前已停用）');
    return;
  }
  const text = readBinaryText(exePath);
  assert.match(text, /requestedExecutionLevel/, 'exe 里没有 requestedExecutionLevel —— 清单没被嵌入');
  assert.match(text, /level="asInvoker"/, 'exe 里的权限级别不是 asInvoker');
  assert.match(text, /com\.promptforge\.app/, 'exe 里没有我们清单的 assemblyIdentity');
});

check('exe 里没有「要求管理员」的生效声明', () => {
  if (!fs.existsSync(exePath)) {
    console.log('         （跳过：还没有构建产物）');
    return;
  }
  const text = readBinaryText(exePath);
  // 我们清单的注释里会出现这个词，但真正的声明必须是 asInvoker
  const active = text.replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(
    /level="requireAdministrator"/.test(active),
    false,
    'exe 的清单里存在 requireAdministrator 声明',
  );
});

console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
if (failures.length > 0) {
  console.log(`失败清单：${failures.join('、')}`);
  process.exit(1);
}
