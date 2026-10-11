/* The queue owns execution; the editor owns selection. Neither switches the other. */
(function (root) {
  class VideoTaskQueue {
    constructor({ process, onChange = () => {}, onComplete = () => {}, now = () => Date.now() }) {
      this.process = process;
      this.onChange = onChange;
      this.onComplete = onComplete;
      this.pending = [];
      this.current = null;
      this.state = 'idle';
      this.promise = null;
      this.controller = null;
      this.wake = null;
      this.now = now;
      this.elapsedMs = 0;
      this.activeSince = null;
      this.stepSince = null;
      this.stepElapsedMs = 0;
      this.stepTimeoutMs = 0;
      this.lastProgressAt = null;
    }
    get active() { return !!this.promise; }
    emit() { this.onChange(this); }
    elapsed(project) {
      return (Number(project?.generationTiming?.elapsedMs) || 0) +
        (this.current === project && this.activeSince != null ? Math.max(0, this.now() - this.activeSince) : 0);
    }
    batchElapsed() { return this.elapsedMs + (this.activeSince != null ? Math.max(0, this.now() - this.activeSince) : 0); }
    stageElapsed() { return this.stepElapsedMs + (this.stepSince != null ? Math.max(0, this.now() - this.stepSince) : 0); }
    freezeClock() {
      if (this.activeSince != null) {
        const duration = Math.max(0, this.now() - this.activeSince);
        this.elapsedMs += duration;
        if (this.current) {
          const timing = this.current.generationTiming;
          timing.elapsedMs += duration; timing.lastAttemptMs += duration;
        }
        this.activeSince = null;
      }
      if (this.stepSince != null) { this.stepElapsedMs += Math.max(0, this.now() - this.stepSince); this.stepSince = null; }
    }
    enqueue(projects) {
      if (!this.active) return this.start(projects);
      if (this.state === 'stopping') return this.promise;
      const ids = new Set([this.current, ...this.pending].filter(Boolean).map(p => p.id));
      for (const p of projects) {
        if (p.deleted || ids.has(p.id)) continue;
        ids.add(p.id); p.generationStatus = 'queued'; p.generationError = null;
        p.generationProgress = 0; p.generationStage = '排队等待'; this.pending.push(p);
      }
      this.emit();
      return this.promise;
    }
    start(projects) {
      if (this.active) return this.promise;
      this.pending = projects.filter(p => !p.deleted);
      if (!this.pending.length) return Promise.resolve();
      this.state = 'running';
      this.elapsedMs = 0;
      this.pending.forEach(p => { p.generationStatus = 'queued'; p.generationError = null; p.generationProgress = 0; p.generationStage = '排队等待'; });
      // Schedule after assigning the promise, including synchronous/empty handlers.
      this.promise = Promise.resolve().then(() => this.drain());
      this.emit();
      return this.promise;
    }
    pause() {
      if (!this.active || this.state !== 'running') return;
      this.state = 'paused';
      this.freezeClock();
      if (this.current) this.current.generationStatus = 'paused';
      this.controller?.abort('pause');
      this.emit();
    }
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'running';
      if (this.current) this.activeSince = this.now();
      if (this.current) this.current.generationStatus = 'running';
      this.wake?.();
      this.emit();
    }
    stop() {
      if (!this.active) return Promise.resolve();
      this.state = 'stopping';
      if (this.current) this.current.generationStatus = 'stopping';
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
        this.stepElapsedMs = 0; this.stepSince = this.now(); this.stepTimeoutMs = timeoutMs; this.lastProgressAt = this.now();
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
          if (this.stepSince != null) { this.stepElapsedMs += Math.max(0, this.now() - this.stepSince); this.stepSince = null; }
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
          project.generationTiming = { elapsedMs: Number(project.generationTiming?.elapsedMs) || 0, lastAttemptMs: 0, attempts: (project.generationTiming?.attempts || 0) + 1 };
          this.activeSince = this.state === 'paused' ? null : this.now();
          this.stepElapsedMs = 0; this.stepSince = null;
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
                if (project.deleted || this.current !== project || this.state !== 'running') return;
                if (Number.isFinite(value)) project.generationProgress = value;
                if (label) project.generationStage = label;
                this.lastProgressAt = this.now();
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
            this.freezeClock();
            project.generationTiming.lastStageMs = this.stepElapsedMs;
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
