import { test, expect } from './fixtures'

test.describe('Settings page', () => {
  test('renders settings page', async ({ mockedPage: page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()
    await expect(page.locator('main')).toBeVisible()
  })

  test('navigable from sidebar', async ({ mockedPage: page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL('/settings')
  })

  test('/settings?tab=runtimes opens runtimes tab', async ({ mockedPage: page }) => {
    await page.goto('/settings?tab=runtimes')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByText(/runtime/i).first()).toBeVisible()
  })

  test('/settings?tab=integrations shows Hugging Face token status', async ({ mockedPage: page }) => {
    await page.goto('/settings?tab=integrations')
    await expect(page.getByRole('heading', { name: /HuggingFace Token/i })).toBeVisible()
    await expect(page.getByText('Test User')).toBeVisible()
    await expect(page.getByText('@testuser')).toBeVisible()
    await expect(page.getByText('Token saved successfully')).toBeVisible()
    await expect(page.getByRole('button', { name: /Disconnect HuggingFace/i })).toBeVisible()
  })
})
