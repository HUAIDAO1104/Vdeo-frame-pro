/* The queue owns execution; the editor owns selection. Neither switches the other. */
(function (root) {
  class VideoTaskQueue {
    constructor({ process, onChange = () => {}, onComplete = () => {} }) {
      this.process = process;
      this.onChange = onChange;
      this.onComplete = onComplete;
      this.pending = [];
      this.current = null;
      this.state = 'idle';
      this.promise = null;
      this.controller = null;
      this.wake = null;
    }
    get active() { return !!this.promise; }
    emit() { this.onChange(this); }
    start(projects) {
      if (this.active) return this.promise;
      this.pending = projects.filter(p => !p.deleted);
      if (!this.pending.length) return Promise.resolve();
      this.state = 'running';
      this.pending.forEach(p => { p.generationStatus = 'queued'; p.generationError = null; });
      // Schedule after assigning the promise, including synchronous/empty handlers.
      this.promise = Promise.resolve().then(() => this.drain());
      this.emit();
      return this.promise;
    }
    pause() {
      if (!this.active || this.state !== 'running') return;
      this.state = 'paused';
      if (this.current) this.current.generationStatus = 'paused';
      this.controller?.abort('pause');
      this.emit();
    }
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'running';
      if (this.current) this.current.generationStatus = 'running';
      this.wake?.();
      this.emit();
    }
    stop() {
      if (!this.active) return Promise.resolve();
      this.state = 'stopping';
      this.pending.forEach(p => { if (!p.deleted) p.generationStatus = 'stopped'; });
      this.pending = [];
      this.controller?.abort('stop');
      this.wake?.();
      this.emit();
      return this.promise;
    }
    remove(project) {
      project.deleted = true;
      this.pending = this.pending.filter(p => p !== project);
      const done = this.current === project ? this.currentDone : Promise.resolve();
      if (this.current === project) { this.controller?.abort('remove'); this.wake?.(); }
      this.emit();
      return done;
    }
    check(project) {
      if (project.deleted || this.state === 'stopping') throw new DOMException('任务已停止', 'AbortError');
    }
    async checkpoint(project) {
      this.check(project);
      while (this.state === 'paused' && !project.deleted) {
        await new Promise(resolve => { this.wake = resolve; });
        this.wake = null;
        this.check(project);
      }
    }
    async step(project, label, operation, timeoutMs = 120000) {
      for (;;) {
        await this.checkpoint(project);
        const controller = new AbortController();
        this.controller = controller;
        project.generationStage = label;
        this.emit();
        const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
        try {
          const value = await operation(controller.signal);
          this.check(project);
          if (controller.signal.aborted) throw new DOMException('操作已中断', 'AbortError');
          return value;
        } catch (error) {
          this.check(project);
          if (controller.signal.reason === 'pause') continue;
          if (controller.signal.reason === 'timeout') throw new Error(label + '超时，请检查视频或网络后重试');
          throw error;
        } finally {
          clearTimeout(timer);
          if (this.controller === controller) this.controller = null;
        }
      }
    }
    async drain() {
      try {
        while (this.pending.length && this.state !== 'stopping') {
          const project = this.pending.shift();
          if (project.deleted) continue;
          this.current = project;
          let finish;
          this.currentDone = new Promise(resolve => { finish = resolve; });
          project.generationStatus = this.state === 'paused' ? 'paused' : 'running';
          this.emit();
          try {
            await this.checkpoint(project);
            const result = await this.process(project, {
              step: (label, operation, timeout) => this.step(project, label, operation, timeout),
              checkpoint: () => this.checkpoint(project),
              progress: (value, label) => {
                if (project.deleted) return;
                project.generationProgress = value;
                if (label) project.generationStage = label;
                this.emit();
              }
            });
            await this.checkpoint(project);
            // Publish only complete results; failed regeneration keeps the old version.
            Object.assign(project, result, { generationStatus: 'complete', generationError: null, generationProgress: 100, generationStage: '已完成' });
            this.onComplete(project);
          } catch (error) {
            if (!project.deleted) {
              if (this.state === 'stopping' || error?.name === 'AbortError') project.generationStatus = 'stopped';
              else {
                project.generationStatus = 'failed';
                project.generationError = { message: String(error?.message || error), stage: project.generationStage || '生成', at: Date.now() };
              }
            }
          } finally {
            this.current = null;
            finish();
            this.emit();
          }
        }
      } finally {
        this.state = 'idle';
        this.promise = null;
        this.controller = null;
        this.emit();
      }
    }
  }
  root.VideoTaskQueue = VideoTaskQueue;
})(globalThis);
