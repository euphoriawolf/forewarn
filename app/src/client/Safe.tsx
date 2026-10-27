// A safety net: if one part of the page fails (the 3D, the chat), it shows a short note in its
// place and the rest of the answer keeps working.
import { Component, type ReactNode } from 'react';

export class Safe extends Component<{ children: ReactNode; note: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('part of the page failed:', e); }
  render() { return this.state.failed ? <p className="fine">{this.props.note}</p> : this.props.children; }
}
