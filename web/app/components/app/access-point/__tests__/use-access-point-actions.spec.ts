import type {
  AppSiteResponse,
  AppSiteUpdatePayload,
} from '@dify/contracts/api/console/apps/types.gen'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { consoleQuery } from '@/service/console'
import { createQueryClientWrapper } from '@/test/console/query-client'
import { createAppDetailFixture, createAppSiteFixture } from '@/test/fixtures/app'
import { createTestQueryClient } from '@/test/query-client'
import { useAccessPointActions } from '../shared/use-access-point-actions'

const mocks = vi.hoisted(() => ({
  fetchAppDetail: vi.fn(),
  toast: vi.fn(),
  updateAppSiteConfig: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({ toast: mocks.toast }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: {
      apps: { byAppId: { get: mocks.fetchAppDetail, site: { post: mocks.updateAppSiteConfig } } },
    },
  }
})

const siteConfig = {
  chat_color_theme: '#000000',
  chat_color_theme_inverted: false,
  copyright: '',
  custom_disclaimer: '',
  default_language: 'en-US',
  description: 'Description',
  icon: '🤖',
  icon_type: 'emoji',
  input_placeholder: '',
  privacy_policy: '',
  prompt_public: false,
  show_workflow_steps: false,
  title: 'App',
  use_icon_as_answer_icon: false,
} satisfies AppSiteUpdatePayload

function renderActions(appId = 'app-1', canManageAccessPoint = true) {
  const queryClient = createTestQueryClient()
  const rendered = renderHook(() => useAccessPointActions(appId, canManageAccessPoint), {
    wrapper: createQueryClientWrapper(queryClient),
  })

  return { ...rendered, queryClient }
}

function detailKey(appId = 'app-1') {
  return consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: appId } } })
}

function deferredDetail() {
  let resolve!: (value: ReturnType<typeof createAppDetailFixture>) => void
  const promise = new Promise<ReturnType<typeof createAppDetailFixture>>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useAccessPointActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.getState().setAppDetail(createAppDetailFixture({ id: 'app-1' }))
    mocks.fetchAppDetail.mockResolvedValue(createAppDetailFixture({ id: 'app-1' }))
    mocks.updateAppSiteConfig.mockResolvedValue({
      app_id: 'app-1',
      customize_token_strategy: 'not_allow',
      default_language: 'en-US',
      prompt_public: false,
      show_workflow_steps: false,
      title: 'Updated site',
      use_icon_as_answer_icon: false,
    } satisfies AppSiteResponse)
  })

  afterEach(() => useAppStore.getState().setAppDetail(undefined))

  it('waits for full detail before committing the site to the store and query cache', async () => {
    const detail = deferredDetail()
    mocks.fetchAppDetail.mockReturnValueOnce(detail.promise)
    const updated = createAppDetailFixture({
      id: 'app-1',
      site: createAppSiteFixture({
        title: 'Saved portal',
        chat_color_theme: '#123456',
        icon_type: 'image',
        icon_url: 'https://files.example.test/saved.png',
      }),
    })
    const { queryClient, result } = renderActions()
    const previous = useAppStore.getState().appDetail
    queryClient.setQueryData(detailKey(), previous)
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries')
    let settled = false
    const save = result.current.saveSiteConfig(siteConfig).then((success) => {
      settled = true
      return success
    })
    await waitFor(() => expect(mocks.fetchAppDetail).toHaveBeenCalled())
    expect(settled).toBe(false)
    expect(useAppStore.getState().appDetail).toEqual(previous)
    expect(queryClient.getQueryData(detailKey())).toEqual(previous)
    await act(async () => detail.resolve(updated))
    expect(await save).toBe(true)
    expect(mocks.updateAppSiteConfig).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: siteConfig,
    })
    expect(useAppStore.getState().appDetail).toEqual(updated)
    expect(queryClient.getQueryData(detailKey())).toEqual(updated)
    for (const queryKey of [
      consoleQuery.apps.get.key(),
      consoleQuery.apps.starred.get.key(),
      consoleQuery.apps.recent.get.key(),
    ])
      expect(invalidation).toHaveBeenCalledWith({ queryKey })
    expect(mocks.toast).toHaveBeenCalledWith('common.actionMsg.modifiedSuccessfully', {
      type: 'success',
    })
  })

  it.each(['post', 'refresh'])(
    'returns false and preserves the committed source when %s fails',
    async (stage) => {
      const { queryClient, result } = renderActions()
      const previous = useAppStore.getState().appDetail
      queryClient.setQueryData(detailKey(), previous)
      if (stage === 'post')
        mocks.updateAppSiteConfig.mockRejectedValueOnce(new Error('Save failed'))
      else mocks.fetchAppDetail.mockRejectedValueOnce(new Error('Refresh failed'))
      expect(await result.current.saveSiteConfig(siteConfig)).toBe(false)
      expect(useAppStore.getState().appDetail).toEqual(previous)
      expect(queryClient.getQueryData(detailKey())).toEqual(previous)
      expect(mocks.toast).toHaveBeenCalledExactlyOnceWith(
        'common.actionMsg.modifiedUnsuccessfully',
        { type: 'error' },
      )
      if (stage === 'post') expect(mocks.fetchAppDetail).not.toHaveBeenCalled()
      expect(await result.current.saveSiteConfig(siteConfig)).toBe(true)
    },
  )

  it('updates the saved app cache without replacing another current app', async () => {
    const detail = deferredDetail()
    mocks.fetchAppDetail.mockReturnValueOnce(detail.promise)
    const { queryClient, result } = renderActions()
    const save = result.current.saveSiteConfig(siteConfig)
    await waitFor(() => expect(mocks.fetchAppDetail).toHaveBeenCalled())
    const nextApp = createAppDetailFixture({ id: 'app-2' })
    act(() => useAppStore.getState().setAppDetail(nextApp))
    const updated = createAppDetailFixture({
      id: 'app-1',
      site: createAppSiteFixture({
        title: 'Saved portal',
        chat_color_theme: '#123456',
        icon_type: 'image',
        icon_url: 'https://files.example.test/saved.png',
      }),
    })
    await act(async () => detail.resolve(updated))
    expect(await save).toBe(true)
    expect(useAppStore.getState().appDetail).toEqual(nextApp)
    expect(queryClient.getQueryData(detailKey())).toEqual(updated)
  })

  it('returns false without a request when management permission is denied', async () => {
    const { result } = renderActions('app-1', false)
    expect(await result.current.saveSiteConfig(siteConfig)).toBe(false)
    expect(mocks.updateAppSiteConfig).not.toHaveBeenCalled()
    expect(mocks.fetchAppDetail).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('preserves the separate token refresh callback contract', async () => {
    const { result } = renderActions()
    const updated = createAppDetailFixture({ id: 'app-1', name: 'Refreshed application' })
    mocks.fetchAppDetail.mockResolvedValueOnce(updated)
    await act(async () => result.current.refreshAppDetail())
    expect(useAppStore.getState().appDetail).toEqual(updated)
    const error = new Error('Token refresh failed')
    mocks.fetchAppDetail.mockRejectedValueOnce(error)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(result.current.refreshAppDetail()).resolves.toBeUndefined()
    expect(errorLog).toHaveBeenCalledWith('Failed to refresh app detail:', error)
    errorLog.mockRestore()
  })
})
