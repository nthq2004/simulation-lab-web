
    isPortConnected(pA, pB) {
        const shortCircuit =CircuitUtils.isPortConnected(pA, pB, this.portToCluster);
        const cA = this.portToCluster(pA);
        const cB = this.portToCluster(pB);
        const startCluster = this.clusters(cA);
        const endCluster = this.clusters(cB);
        const r = this._getParallelResistanceBetweenClusters(startCluster,endCluster);
        return shortCircuit||r<1;
    }
### this is a level
#### a
```
this is
```