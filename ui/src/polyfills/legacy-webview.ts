type SortComparator<T> = (a: T, b: T) => number;

function defineValue(target: object, key: PropertyKey, value: unknown) {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
  });
}

function installArrayPolyfills() {
  if (!Array.prototype.toSorted) {
    defineValue(Array.prototype, "toSorted", function toSorted<
      T,
    >(this: T[], compareFn?: SortComparator<T>) {
      return [...this].toSorted(compareFn);
    });
  }

  if (!Array.prototype.toReversed) {
    defineValue(Array.prototype, "toReversed", function toReversed<T>(this: T[]) {
      return [...this].toReversed();
    });
  }

  if (!Array.prototype.at) {
    defineValue(Array.prototype, "at", function at<T>(this: T[], index: number) {
      const normalized = Math.trunc(index) || 0;
      const resolved = normalized >= 0 ? normalized : this.length + normalized;
      return this[resolved];
    });
  }
}

function installObjectPolyfills() {
  if (!Object.hasOwn) {
    defineValue(Object, "hasOwn", (obj: object, key: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(obj, key),
    );
  }
}

installArrayPolyfills();
installObjectPolyfills();
