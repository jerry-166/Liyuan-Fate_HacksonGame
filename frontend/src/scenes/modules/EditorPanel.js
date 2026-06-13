/**
 * EditorPanel — 内联编辑器面板（iframe 覆盖层）
 *
 * 职责：在游戏画布上叠加一个 iframe，加载 editor.html，
 * 通过 postMessage 与编辑器双向通信。替代 window.open 弹窗方案。
 *
 * @module scenes/modules/EditorPanel
 */

export class EditorPanel {
  constructor(scene) {
    this.scene = scene;
    this.visible = false;
    this._handlers = [];

    // Editor config
    this._editorUrl = null;
    this._mode = null;        // 'chapter' | 'skeleton' | 'scripts' | 'generate'
    this._params = {};        // { session_id, chapter_id, script_id, view }
  }

  // ═══════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════

  createPanel() {
    const scene = this.scene;

    // ── Full-screen overlay container ──
    this._overlay = document.createElement('div');
    this._overlay.id = 'editor-overlay';
    Object.assign(this._overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      zIndex: '9999',
      background: 'rgba(10, 10, 20, 0.60)',
      display: 'none',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      transition: 'opacity 0.3s ease',
    });
    document.body.appendChild(this._overlay);

    // ── Iframe container (centered card) ──
    const card = document.createElement('div');
    card.id = 'editor-card';
    Object.assign(card.style, {
      width: '95%',
      maxWidth: '1280px',
      height: '88%',
      maxHeight: '820px',
      background: '#0a0a14',
      borderRadius: '12px',
      border: '1px solid rgba(180,140,90,0.3)',
      boxShadow: '0 8px 48px rgba(0,0,0,0.8), 0 0 0 1px rgba(212,184,150,0.1)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease',
      transform: 'scale(0.96)',
      opacity: '0',
    });
    this._overlay.appendChild(card);

    // ── Top bar (title + close) ──
    const topBar = document.createElement('div');
    Object.assign(topBar.style, {
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      height: '44px',
      background: '#111120',
      borderBottom: '1px solid rgba(180,140,90,0.2)',
      flexShrink: '0',
    });
    card.appendChild(topBar);

    const title = document.createElement('span');
    title.textContent = '剧本工坊';
    Object.assign(title.style, {
      fontFamily: '"KaiTi","SimSun",serif',
      fontSize: '16px',
      color: '#d4b896',
      letterSpacing: '4px',
      flexGrow: '1',
    });
    topBar.appendChild(title);

    const subtitle = document.createElement('span');
    subtitle.id = 'editor-subtitle';
    subtitle.textContent = '';
    Object.assign(subtitle.style, {
      fontSize: '12px',
      color: '#a09080',
      marginRight: '16px',
    });
    topBar.appendChild(subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 关闭';
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: '1px solid rgba(180,140,90,0.3)',
      color: '#a09080',
      padding: '4px 12px',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '13px',
      fontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
    });
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.borderColor = 'rgba(212,184,150,0.6)';
      closeBtn.style.color = '#d4b896';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.borderColor = 'rgba(180,140,90,0.3)';
      closeBtn.style.color = '#a09080';
    });
    closeBtn.addEventListener('click', () => this.hide());
    topBar.appendChild(closeBtn);

    this._closeBtn = closeBtn;
    this._card = card;
    this._subtitle = subtitle;

    // ── iframe ──
    this._iframe = document.createElement('iframe');
    this._iframe.id = 'editor-iframe';
    this._iframe.setAttribute('allow', 'clipboard-write');
    Object.assign(this._iframe.style, {
      flex: '1',
      width: '100%',
      border: 'none',
      background: '#0a0a14',
    });
    card.appendChild(this._iframe);

    // ── Click outside to close (click on overlay bg) ──
    this._overlay.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.hide();
    });

    // ── postMessage listener from iframe ──
    this._onMessage = (event) => {
      if (!this.scene) return; // destroyed
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'EDITOR_CLOSED':
          this.hide();
          break;
        case 'CHAPTER_DETAIL_SAVED':
          // Refresh task panel (only in UIScene)
          if (this.scene.taskPanel) this.scene.taskPanel.refreshContent();
          break;
        case 'SELECT_SCRIPT':
          // Script selected from editor — pass both id and name for naming dialog
          if (this._onScriptSelected) this._onScriptSelected(data.script_id, data.script_name);
          break;
        case 'SKELETON_SAVED':
          // Skeleton saved — could refresh
          break;
      }
    };
    window.addEventListener('message', this._onMessage);
  }

  // ═══════════════════════════════════════════════
  // Show / Hide
  // ═══════════════════════════════════════════════

  /**
   * Show the editor in a specific mode.
   * @param {'chapter'|'skeleton'|'scripts'|'generate'} mode
   * @param {object} params - { session_id, chapter_id, script_id }
   */
  show(mode, params = {}) {
    // Guard: panel might have been destroyed
    if (!this._overlay || !this._iframe) {
      console.warn('[EditorPanel] show() called after destroy, recreating panel');
      this.createPanel();
    }

    this._mode = mode;
    this._params = params;

    const qp = new URLSearchParams();
    qp.set('view', mode);
    if (params.session_id) qp.set('session_id', params.session_id);
    if (params.chapter_id) qp.set('chapter_id', params.chapter_id);
    if (params.script_id) qp.set('script_id', params.script_id);
    // Flag to tell editor it's inside an iframe
    qp.set('embedded', '1');

    this._editorUrl = `/editor.html?${qp.toString()}`;

    // Update subtitle
    const subtitles = {
      chapter: params.chapter_id ? `章节 · ${params.chapter_id}` : '章节详情',
      skeleton: params.script_id ? `骨架 · ${params.script_id}` : '骨架编辑',
      scripts: '剧本库',
      generate: 'AI 创作',
    };
    this._subtitle.textContent = subtitles[mode] || '';

    // Show overlay with animation
    this._overlay.style.display = 'flex';
    requestAnimationFrame(() => {
      this._card.style.transform = 'scale(1)';
      this._card.style.opacity = '1';
    });

    // Load iframe
    this._iframe.src = this._editorUrl;
    this.visible = true;

    // Lock game input (safe — MenuScene has no GameScene)
    try {
      const gs = this.scene.scene.get('GameScene');
      if (gs) gs.events.emit('input:lock', true);
    } catch (_) { /* no GameScene in this context */ }

    // Focus the iframe after load
    this._iframe.addEventListener('load', () => {
      if (this._iframe && this._iframe.contentWindow) {
        try { this._iframe.contentWindow.focus(); } catch (_) {}
      }
    }, { once: true });
  }

  hide() {
    if (!this.visible || !this._overlay) return;

    // Animate out
    this._card.style.transform = 'scale(0.96)';
    this._card.style.opacity = '0';
    setTimeout(() => {
      this._overlay.style.display = 'none';
      this._iframe.src = 'about:blank';
      this.visible = false;
      this._mode = null;
      this._params = {};

      // Unlock game input (safe)
      try {
        const gs = this.scene.scene.get('GameScene');
        if (gs) gs.events.emit('input:lock', false);
      } catch (_) { /* no GameScene */ }
    }, 250);
  }

  /**
   * 暂停编辑器 — 隐藏 overlay 但保留 iframe 状态
   * 用于在编辑器上方弹出命名对话框的场景，返回后可恢复
   */
  pause() {
    if (!this._overlay) return;
    this._overlay.style.display = 'none';
    // ★ 不重置 iframe.src，保留编辑器状态
  }

  /**
   * 恢复编辑器 — 重新显示 overlay（iframe 状态完整保留）
   */
  resume() {
    if (!this._overlay || !this.visible) return;
    this._overlay.style.display = 'flex';
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show('scripts');
  }

  /** Check if editor is currently visible */
  isVisible() {
    return this.visible && !!this._overlay;
  }

  /** Register callback for script selection */
  onScriptSelected(callback) {
    this._onScriptSelected = callback;
  }

  // ═══════════════════════════════════════════════
  // Resize
  // ═══════════════════════════════════════════════

  onResize() {
    // The iframe is fixed-positioned, so no explicit resize needed
    // But we might want to adjust max dimensions
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (this._card) {
      if (vw < 768) {
        this._card.style.width = '100%';
        this._card.style.height = '100%';
        this._card.style.maxWidth = '100%';
        this._card.style.maxHeight = '100%';
        this._card.style.borderRadius = '0';
      } else {
        this._card.style.width = '95%';
        this._card.style.maxWidth = '1280px';
        this._card.style.height = '88%';
        this._card.style.maxHeight = '820px';
        this._card.style.borderRadius = '12px';
      }
    }
  }

  // ═══════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════

  destroy() {
    if (!this._overlay) return; // already destroyed
    this.hide();
    if (this._onMessage) {
      window.removeEventListener('message', this._onMessage);
      this._onMessage = null;
    }
    if (this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;
    this._card = null;
    this._iframe = null;
    this._closeBtn = null;
    this._subtitle = null;
    this.scene = null;
  }
}
