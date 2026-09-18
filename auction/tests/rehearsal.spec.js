import { test, expect } from "@playwright/test";

async function signIn(page, path, password) {
  await page.goto(path);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#state-status")).toHaveText(
    "Auction updates connected",
  );
}
async function stubYouTube(context) {
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
  window.YT={PlayerState:{PLAYING:1,ENDED:0},Player:class{
    constructor(id,options){this.options=options;this.el=document.getElementById(id);this.el.dataset.video=options.videoId;this.el.textContent='Recorded lot video (test player)';setTimeout(()=>options.events.onReady(),10);}
    mute(){this.el.dataset.muted='true'}
    loadVideoById(id){this.el.dataset.video=id;this.playVideo()}
    playVideo(){this.options.events.onStateChange({data:1})}
    pauseVideo(){} seekTo(){}
  }};window.onYouTubeIframeAPIReady();`,
    }),
  );
}

test("real LiveKit broadcast, operator fallback, lot sync and silent mode", async ({
  browser,
}) => {
  const operatorContext = await browser.newContext();
  const phoneContext = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  await phoneContext.addInitScript(() => {
    window.rehearsalEvents = [];
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(...args) {
        super(...args);
        window.rehearsalEvents.push(this);
      }
    };
  });
  const viewerContext = await browser.newContext();
  await stubYouTube(viewerContext);
  const operator = await operatorContext.newPage(),
    phone = await phoneContext.newPage(),
    viewer = await viewerContext.newPage();
  const errors = [];
  for (const p of [operator, phone, viewer])
    p.on("pageerror", (e) => errors.push(e.message));
  try {
    await signIn(
      operator,
      "http://localhost:8097/operator",
      process.env.OPERATOR_PASSWORD,
    );
    await operator.locator('[data-mode="live"]').click();
    await expect(operator.locator('[data-mode="live"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await signIn(
      phone,
      "http://localhost:8097/broadcast",
      process.env.BROADCAST_PASSWORD,
    );
    await phone.locator("#start-broadcast").click();
    await expect(phone.locator("#broadcast-status")).toHaveText(
      "Broadcasting live camera and microphone.",
      { timeout: 25000 },
    );
    await viewer.goto("http://localhost:8097/");
    await viewer.locator("#join").click();
    await expect(viewer.locator("#visual-label")).toHaveText("LIVE CAMERA", {
      timeout: 25000,
    });
    await expect(viewer.locator("#media-status")).toHaveText(
      "Live auctioneer audio",
    );
    await viewer.screenshot({
      path: "test-results/viewer-live.png",
      fullPage: true,
    });
    await operator.locator('[data-mode="audio"]').click();
    await expect(phone.locator("#broadcast-status")).toContainText(
      "Camera upload stopped.",
    );
    await expect
      .poll(() =>
        phone
          .locator("#live-video")
          .evaluate(
            (el) =>
              el.srcObject
                ?.getVideoTracks()
                .filter((t) => t.readyState === "live" && t.enabled).length ||
              0,
          ),
      )
      .toBe(0);
    await expect(viewer.locator("#visual-label")).toHaveText(
      "RECORDED LOT VIDEO",
    );
    await expect(viewer.locator("#media-status")).toHaveText(
      "Live auctioneer audio",
    );
    await expect(viewer.locator("#youtube-player")).toHaveAttribute(
      "data-muted",
      "true",
    );
    await operator.locator("#lot-select").selectOption("7");
    await operator.locator("#change-lot").click();
    await expect(viewer.locator("#lot-number")).toHaveText("07");
    await expect(viewer.locator("#youtube-player")).toHaveAttribute(
      "data-video",
      "CtEqSwhqrG8",
    );
    await operator.locator('[data-mode="recorded"]').click();
    await expect(phone.locator("#broadcast-status")).toContainText(
      "Camera and microphone stopped",
    );
    await expect(viewer.locator("#media-status")).toContainText(
      "Live audio unavailable",
    );
    await viewer.locator("#prefer-image").check();
    await expect(viewer.locator("#visual-label")).toHaveText("LOT IMAGE");
    await operator.screenshot({
      path: "test-results/operator.png",
      fullPage: true,
    });
    await phone.screenshot({
      path: "test-results/broadcaster.png",
      fullPage: true,
    });
    await viewer.setViewportSize({ width: 390, height: 844 });
    await viewer.screenshot({
      path: "test-results/viewer-mobile.png",
      fullPage: true,
    });
    expect(
      await viewer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await operator.locator('[data-mode="live"]').click();
    await expect(phone.locator("#broadcast-status")).toHaveText(
      "Broadcasting live camera and microphone.",
    );
    await viewer.locator("#prefer-image").uncheck();
    await expect(viewer.locator("#visual-label")).toHaveText("LIVE CAMERA");
    // Lose only the auction-state connection while WebRTC remains connected.
    // The phone must stop camera upload after heartbeat expiry and retain audio.
    await phone.evaluate(() =>
      window.rehearsalEvents.forEach((source) => source.close()),
    );
    await expect(phone.locator("#state-status")).toContainText("reconnecting", {
      timeout: 13000,
    });
    await expect(phone.locator("#broadcast-status")).toContainText(
      "Camera upload stopped.",
    );
    await expect(viewer.locator("#visual-label")).toHaveText(
      "RECORDED LOT VIDEO",
    );
    await expect(viewer.locator("#media-status")).toHaveText(
      "Live auctioneer audio",
    );
    await phone.locator("#stop-broadcast").click();
    await expect(viewer.locator("#visual-label")).toHaveText(
      "RECORDED LOT VIDEO",
    );
    await expect(viewer.locator("#media-status")).toContainText(
      "Live audio unavailable",
    );
    expect(errors).toEqual([]);
  } finally {
    await operatorContext.close();
    await phoneContext.close();
    await viewerContext.close();
  }
});

test("blocked YouTube falls back to the lot image with retry", async ({
  page,
}) => {
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await page.locator("#join").click();
  await expect(page.locator("#retry-video")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#visual-label")).toHaveText("LOT IMAGE");
  await expect(page.locator("#fallback-image")).toBeVisible();
});

test("viewer catalogue and private role screens on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#lot-number")).not.toHaveText("");
  await expect(
    page.getByRole("button", { name: "Bidding not open" }),
  ).toBeDisabled();
  await expect(page.locator("#detail-image")).toBeVisible();
  expect(
    await page
      .locator("#detail-image")
      .evaluate((el) => el.complete && el.naturalWidth > 0),
  ).toBe(true);
  await page.goto("/operator");
  await expect(page.locator("#login-panel")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();
});
