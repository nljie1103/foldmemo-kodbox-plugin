/** Shared category semantics for both notes and records. No vault schema change. */
import type { Item } from './vault'
export const UNFILED_CHOICE = '__foldmemo_note_unfiled__'
export const UNFILED_FILTER = 'uncategorized'

export function initialCategoryId(categoryIds:readonly string[], currentFilter:string):string {
  if (categoryIds.includes(currentFilter)) return currentFilter
  if (currentFilter === UNFILED_FILTER) return ''
  return categoryIds[0] ?? ''
}

export function categoryForSave(kind:Item['kind'], chosen:string, categoryIds:readonly string[]):string {
  if (kind==='note' && chosen==='') return ''
  if (!categoryIds.includes(chosen)) {
    if (kind==='record' && !categoryIds.length) throw Error('请先创建分类')
    throw Error('请选择有效分类')
  }
  return chosen
}

export function matchesItemFilter(item:Pick<Item,'kind'|'categoryId'|'favorite'>, selected:string):boolean {
  if (selected==='all') return true
  if (selected==='favorites') return item.favorite
  if (selected===UNFILED_FILTER) return item.kind==='note' && !item.categoryId
  return item.categoryId===selected
}
