'use client'

import type { AppSiteUpdatePayload } from '@dify/contracts/api/console/apps/types.gen'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'

export function useAccessPointActions(appId: string, canManageAccessPoint: boolean) {
  const { t } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const setAppDetail = useAppStore((state) => state.setAppDetail)
  const refreshAppDetail = useCallback(async () => {
    try {
      const appDetail = await consoleClient.apps.byAppId.get({ params: { app_id: appId } })
      setAppDetail(appDetail)
    } catch (error) {
      console.error('Failed to refresh app detail:', error)
    }
  }, [appId, setAppDetail])

  const saveSiteConfig = useCallback(
    async (params: AppSiteUpdatePayload): Promise<boolean> => {
      if (!canManageAccessPoint) return false
      try {
        await consoleClient.apps.byAppId.site.post({
          params: { app_id: appId },
          body: params,
        })
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: appId } },
          }),
        })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.starred.get.key() })
        void queryClient.invalidateQueries({ queryKey: consoleQuery.apps.recent.get.key() })
        void refreshAppDetail()
        toast(
          t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }),
          { type: 'success' },
        )
        return true
      } catch {
        toast(
          t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
          { type: 'error' },
        )
        return false
      }
    },
    [appId, canManageAccessPoint, queryClient, refreshAppDetail, t],
  )

  return {
    refreshAppDetail,
    saveSiteConfig,
  }
}
