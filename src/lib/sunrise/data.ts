// What GET /api/tasks/sunrise returns, shared by the route and the page.
import type {HorizonData} from '@/lib/horizon'
import type {FormSpec} from './form-spec'

export interface SunriseData {
  horizon: HorizonData
  forms: Record<string, FormSpec> // by task id: every task on the rings, the ground and further out
  today: {id: string, short: string, completed: boolean}[] // Today's list, both lists, without the dailies
  current: Record<string, number> // rank in the Current queues, 0 first
  started: Record<string, string> // tasks he has opened in Sunrise, and when
}
