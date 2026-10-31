export class Emitter<E extends { [K in keyof E]: unknown }> {
  private handlers: { [K in keyof E]?: ((v: E[K]) => void)[] } = {};

  on<K extends keyof E>(k: K, cb: (v: E[K]) => void): () => void {
    (this.handlers[k] ??= []).push(cb);
    return () => {
      this.handlers[k] = this.handlers[k]!.filter((h) => h !== cb);
    };
  }

  protected emit<K extends keyof E>(k: K, v: E[K]): void {
    this.handlers[k]?.forEach((h) => h(v));
  }
}
