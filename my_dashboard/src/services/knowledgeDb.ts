import type { Overview } from '../types'

const API = 'http://127.0.0.1:8787/api/overview'
export async function fetchKnowledgeOverview(): Promise<Overview> {
  const response = await fetch(API)
  if (!response.ok) throw new Error(`Knowledge API ${response.status}`)
  return response.json() as Promise<Overview>
}
