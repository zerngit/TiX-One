import { useEffect, useState } from 'react'
import { concerts as staticConcerts } from '../data/concerts'
import { supabase, type SupabaseConcert } from '../lib/supabase'

const withDefaults = (c: any): SupabaseConcert => ({
  ...c,
  concert_object_id: c.concert_object_id ?? null,
  waitlist_object_id: c.waitlist_object_id ?? null,
})

export function useConcerts() {
  const [concerts, setConcerts] = useState<SupabaseConcert[]>([])
  const [loading, setLoading] = useState(true)

  const fetchConcerts = () => {
    if (!supabase) {
      setConcerts(staticConcerts.map(withDefaults))
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('concerts')
      .select('*')
      .order('date', { ascending: true })
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        if (error || !data || data.length === 0) {
          console.warn('[useConcerts] Supabase fetch failed, using static data:', error?.message)
          setConcerts(staticConcerts.map(withDefaults))
        } else {
          setConcerts((data as any[]).map(withDefaults))
        }
        setLoading(false)
      })
  }

  useEffect(() => { fetchConcerts() }, [])

  return { concerts, loading, refetch: fetchConcerts }
}

export function useConcertById(id: string | undefined) {
  const { concerts, loading, refetch } = useConcerts()
  const concert = id ? concerts.find((c) => c.id === id) ?? null : null
  return { concert, loading, refetch }
}
