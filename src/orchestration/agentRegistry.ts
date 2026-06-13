import { ValidationError } from "../db/errors.js";
import type { Agent, AgentType } from "./types.js";

export class AgentRegistry {
  private readonly agents = new Map<AgentType, Agent<unknown, unknown>>();
  register<I, O>(agent: Agent<I, O>, options: { override?: boolean } = {}): void {
    if (this.agents.has(agent.type) && !options.override) throw new ValidationError(`Agent already registered: ${agent.type}`);
    this.agents.set(agent.type, agent as Agent<unknown, unknown>);
  }
  get(type: AgentType): Agent<unknown, unknown> { const agent = this.agents.get(type); if (!agent) throw new ValidationError(`Required agent is not registered: ${type}`); return agent; }
  verify(types: AgentType[]): void { types.forEach((type) => this.get(type)); }
}
