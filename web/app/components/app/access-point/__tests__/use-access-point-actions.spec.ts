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

  it('succeeds after POST while detail refresh continues in the background', async () => {
    const detail = deferredDetail()
    mocks.fetchAppDetail.mockReturnValueOnce(detail.promise)
    const updated = createAppDetailFixture({
      id: 'app-1',
      site: createAppSiteFixture({ title: 'Saved portal' }),
    })
    const { queryClient, result } = renderActions()
    const previous = useAppStore.getState().appDetail
    queryClient.setQueryData(detailKey(), previous)

    expect(await result.current.saveSiteConfig(siteConfig)).toBe(true)
    expect(mocks.updateAppSiteConfig).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      body: siteConfig,
    })
    expect(mocks.fetchAppDetail).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
    expect(useAppStore.getState().appDetail).toEqual(previous)
    expect(queryClient.getQueryState(detailKey())?.isInvalidated).toBe(true)
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('common.actionMsg.modifiedSuccessfully', {
      type: 'success',
    })

    await act(async () => detail.resolve(updated))
    await waitFor(() => expect(useAppStore.getState().appDetail).toEqual(updated))
  })

  it('returns false after POST failure and allows retrying without refreshing failed saves', async () => {
    const { result } = renderActions()
    const previous = useAppStore.getState().appDetail
    mocks.updateAppSiteConfig.mockRejectedValueOnce(new Error('Save failed'))

    expect(await result.current.saveSiteConfig(siteConfig)).toBe(false)
    expect(useAppStore.getState().appDetail).toEqual(previous)
    expect(mocks.fetchAppDetail).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('common.actionMsg.modifiedUnsuccessfully', {
      type: 'error',
    })
    expect(await result.current.saveSiteConfig(siteConfig)).toBe(true)
  })

  it('keeps a successful save successful when the background detail refresh fails', async () => {
    const { result } = renderActions()
    const previous = useAppStore.getState().appDetail
    const error = new Error('Refresh failed')
    mocks.fetchAppDetail.mockRejectedValueOnce(error)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await result.current.saveSiteConfig(siteConfig)).toBe(true)
    await waitFor(() =>
      expect(errorLog).toHaveBeenCalledWith('Failed to refresh app detail:', error),
    )
    expect(useAppStore.getState().appDetail).toEqual(previous)
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('common.actionMsg.modifiedSuccessfully', {
      type: 'success',
    })
    errorLog.mockRestore()
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
