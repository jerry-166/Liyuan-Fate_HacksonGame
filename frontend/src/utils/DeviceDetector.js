/**
 * 设备检测工具 — 判断当前运行环境（移动端/桌面端、横屏/竖屏）
 *
 * @module utils/DeviceDetector
 */

/** 缓存检测结果，避免每帧重复计算 */
let _cachedIsMobile = null;
let _cachedIsLandscape = null;

/**
 * 检测是否为移动端设备
 * 基于 touch 支持 + userAgent 组合判断
 * @returns {boolean}
 */
export function isMobileDevice() {
  if (_cachedIsMobile !== null) return _cachedIsMobile;
  const hasTouch = ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints > 0);
  const mobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  _cachedIsMobile = hasTouch && mobileUA;

  // ★ 监听设备变化（如连接/断开键盘）时重置缓存
  window.addEventListener('resize', () => { _cachedIsMobile = null; });

  return _cachedIsMobile;
}

/**
 * 检测当前屏幕是否为横屏（宽度 > 高度）
 * @returns {boolean}
 */
export function isLandscape() {
  _cachedIsLandscape = window.innerWidth > window.innerHeight;
  return _cachedIsLandscape;
}

/**
 * 获取设计分辨率到实际画布的缩放因子
 * 设计分辨率 1280x800，FIT 模式下自动缩放
 * @param {number} designW - 设计宽度 (1280)
 * @param {number} designH - 设计高度 (800)
 * @returns {{ scaleX: number, scaleY: number, scale: number }}
 */
export function getScaleFactors(designW = 1280, designH = 800) {
  const actualW = window.innerWidth;
  const actualH = window.innerHeight;
  const scaleX = actualW / designW;
  const scaleY = actualH / designH;
  return {
    scaleX,
    scaleY,
    scale: Math.min(scaleX, scaleY), // FIT 模式等比例缩放
  };
}

/**
 * 检查浏览器当前是否处于全屏状态
 * @returns {boolean}
 */
export function isFullscreen() {
  return !!(document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement);
}

/**
 * 切换全屏 / 退出全屏
 * @returns {Promise<void>}
 */
export async function toggleFullscreen() {
  if (isFullscreen()) {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      await document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      await document.msExitFullscreen();
    }
  } else {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    } else if (el.msRequestFullscreen) {
      await el.msRequestFullscreen();
    }
  }
}
