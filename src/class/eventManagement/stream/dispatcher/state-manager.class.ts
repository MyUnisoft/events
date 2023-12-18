export class StateManager {
  public _isLeader = false;

  get isLeader(): boolean {
    return this._isLeader;
  }

  set isLeader(state: boolean) {
    this._isLeader = state;
  }
}
