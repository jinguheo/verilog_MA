import type { Overview } from '../types'

const API = '/api/overview'
export async function fetchKnowledgeOverview(): Promise<Overview> {
  const response = await fetch(API)
  if (!response.ok) throw new Error(`Knowledge API ${response.status}`)
  return response.json() as Promise<Overview>
}
