/**
 * 音乐管理器 — 根据当前场景自动切换 BGM
 * @module scenes/modules/MusicManager
 */

/** 子场景ID → 音乐文件 key 映射 */
const SUB_SCENE_MUSIC = {
  graveyard: 'bgm_graveyard',
  stage: 'bgm_stage',
  tea_house: 'bgm_tea_house',
  dock: 'bgm_dock',
  ancestral_hall: 'bgm_ancestral_hall',
  fathers_house: 'bgm_fathers_house',
};

/** 主地图音乐 key */
const MAIN_THEME_KEY = 'bgm_main_theme';

/** 所有音乐定义：Phaser key → 文件路径 */
const MUSIC_DEFS = [
  { key: 'bgm_graveyard', path: '/assets/audio/graveyard.mp3' },
  { key: 'bgm_stage', path: '/assets/audio/stage.mp3' },
  { key: 'bgm_tea_house', path: '/assets/audio/tea_house.mp3' },
  { key: 'bgm_dock', path: '/assets/audio/dock.mp3' },
  { key: 'bgm_ancestral_hall', path: '/assets/audio/ancestral_hall.mp3' },
  { key: 'bgm_fathers_house', path: '/assets/audio/fathers_house.mp3' },
  { key: MAIN_THEME_KEY, path: '/assets/audio/main_theme.mp3' },
];

/** 淡入时长（毫秒） */
const FADE_IN_DURATION = 1500;

export class MusicManager {
  constructor(gameScene) {
    this.scene = gameScene;
    this._currentKey = null;
    this._currentScene = null; // 当前场景ID（null=主地图）
    this._volume = parseFloat(localStorage.getItem('__music_volume__') || '0.7');
    this._muted = localStorage.getItem('__music_muted__') === 'true';
    this._ready = false;
    this._fadeTween = null; // 当前正在执行的渐变 tween
  }

  /** 首次加载所有音乐（在 GameScene.create() 中调用一次） */
  preloadAll() {
    const load = this.scene.load;
    for (const def of MUSIC_DEFS) {
      if (!this.scene.cache.audio.exists(def.key)) {
        load.audio(def.key, def.path);
      }
    }
  }

  /** 启动音频上下文（首次用户交互后调用） */
  start() {
    if (this._ready) return;
    this._ready = true;
    if (this._currentKey) {
      this._playCurrent();
    }
  }

  /**
   * 播放指定场景的音乐
   * @param {string|null} subSceneId - 子场景ID，null 表示主地图
   */
  playForScene(subSceneId = null) {
    if (subSceneId === this._currentScene) return;
    this._currentScene = subSceneId;

    const key = subSceneId ? SUB_SCENE_MUSIC[subSceneId] : MAIN_THEME_KEY;
    if (!key) return;

    this._switchTo(key);
  }

  /** 切换到主地图音乐 */
  playMainTheme() {
    this.playForScene(null);
  }

  /** 获取目标音量 */
  _targetVolume() {
    return this._muted ? 0 : this._volume;
  }

  /** 获取指定 key 的 sound 实例 */
  _getSound(key) {
    return this.scene.sound.get(key);
  }

  /** 播放当前音乐（首次，带淡入） */
  _playCurrent() {
    const key = this._currentKey;
    if (!key || !this.scene.cache.audio.exists(key)) return;
    try {
      const sound = this.scene.sound.add(key, { loop: true, volume: 0 });
      sound.play();
      console.log('[MusicManager] play:', key, 'fading in...');
      this._fadeIn(sound, this._targetVolume(), FADE_IN_DURATION);
    } catch (e) {
      console.warn('[MusicManager] play failed:', key, e.message);
    }
  }

  /**
   * 切换音乐：先彻底停掉所有旧音乐，再播新的
   * 无论切换多快，永远只有一首在播放
   * @param {string} newKey
   */
  _switchTo(newKey) {
    if (newKey === this._currentKey) return;

    const oldKey = this._currentKey;

    // 1. 停止当前渐变 tween
    this._stopFadeTween();

    // 2. 停止所有音乐实例（包括同一key的多个实例）
    this._stopAllMusic();

    // 3. 更新
    this._currentKey = newKey;

    if (!this._ready) return;
    if (!this.scene.cache.audio.exists(newKey)) return;

    try {
      const sound = this.scene.sound.add(newKey, { loop: true, volume: 0 });
      sound.play();
      console.log('[MusicManager] switch:', oldKey, '→', newKey);
      this._fadeIn(sound, this._targetVolume(), FADE_IN_DURATION);
    } catch (e) {
      console.warn('[MusicManager] switch failed:', newKey, e.message);
    }
  }

  /** 停止所有 BGM（所有key的所有实例），消除残留 */
  _stopAllMusic() {
    const allKeys = [MAIN_THEME_KEY, ...Object.values(SUB_SCENE_MUSIC)];
    for (const key of allKeys) {
      const instances = this.scene.sound.getAll(key);
      for (const s of instances) {
        this.scene.tweens.killTweensOf(s);
        if (s.isPlaying || s.isPaused) {
          s.stop();
        }
      }
    }
  }

  /**
   * 淡入：将 sound 从当前音量渐变到目标音量
   * @param {Phaser.Sound.BaseSound} sound
   * @param {number} targetVol - 目标音量 (0~1)
   * @param {number} duration - 时长(ms)
   */
  _fadeIn(sound, targetVol, duration) {
    if (!sound || !sound.isPlaying) return;
    this._stopFadeTween();
    this._fadeTween = this.scene.tweens.add({
      targets: sound,
      volume: targetVol,
      duration: duration,
      ease: 'Cubic.easeIn',
      onComplete: () => { this._fadeTween = null; },
    });
  }

  /** 取消当前淡入 tween */
  _stopFadeTween() {
    if (this._fadeTween) {
      this._fadeTween.stop();
      this._fadeTween = null;
    }
  }

  /** 设置音量 (0~1)，当前音乐即时渐变 */
  setVolume(vol) {
    this._volume = Math.max(0, Math.min(1, vol));
    localStorage.setItem('__music_volume__', String(this._volume));
    if (!this._muted && this._currentKey) {
      const sound = this._getSound(this._currentKey);
      if (sound) {
        this._fadeIn(sound, this._volume, 300);
      }
    }
  }

  /** 静音切换，当前音乐即时渐变 */
  toggleMute() {
    this._muted = !this._muted;
    localStorage.setItem('__music_muted__', String(this._muted));
    const target = this._muted ? 0 : this._volume;
    if (this._currentKey) {
      const sound = this._getSound(this._currentKey);
      if (sound) {
        this._fadeIn(sound, target, 300);
      }
    }
    return this._muted;
  }

  /** 销毁：停止所有音乐 */
  destroy() {
    this._stopAllMusic();
    this._currentKey = null;
    this._currentScene = null;
    this._ready = false;
  }
}
