import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole, FullscreenLoader, homeFor } from '@/auth/RequireRole';
import { ADMIN_BASE, adminPath } from '@/lib/adminPath';
import { useAuth } from '@/auth/AuthContext';
import { RequireSignIn } from '@/auth/SignInGate';
import { ScrollManager } from '@/components/layout/ScrollManager';
import { ScrollReveal } from '@/components/layout/ScrollReveal';
import { LiveRefreshGate } from '@/components/layout/LiveRefreshGate';
import { PresenceTracker } from '@/components/layout/PresenceTracker';
import { AnalyticsTracker } from '@/components/layout/AnalyticsTracker';
import { LaunchNotice } from '@/components/layout/LaunchNotice';
import { MaintenanceNotice } from '@/components/layout/MaintenanceNotice';
import { EnvBadge } from '@/components/layout/EnvBadge';

import { BuyerLayout } from '@/components/layout/BuyerLayout';
import { Home } from '@/pages/buyer/Home';
import { POLICY_SLUGS } from '@/data/policies';

/**
 * The seller and admin consoles are only ever reached by signed-in
 * sellers/admins (gated by RequireRole), so their code is split into
 * per-route chunks with React.lazy. A first-time buyer no longer downloads
 * the entire seller + admin bundle just to view a product. The page modules
 * use named exports, so each import is remapped to a default for lazy().
 */
const lazyNamed = <M, K extends keyof M>(loader: () => Promise<M>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));

/*
 * ── The buyer storefront is split the same way ──────────────────────────────
 *
 * It was not, and that was the single biggest thing on the home page's critical
 * path: every buyer screen — checkout, the chat client, the order tracker, the
 * seven policy pages — was a static import, so all of it landed in one 552 kB
 * entry chunk that a first-time visitor had to download, parse and execute
 * before the homepage could paint. None of it is reachable from the homepage
 * without a tap.
 *
 * `Home` and `BuyerLayout` stay static on purpose: they are what `/` renders,
 * and making them lazy would only trade bundle size for an extra round trip on
 * the one route that must be fastest. Everything else is fetched on navigation,
 * with the two most likely next screens warmed on idle (`RoutePrefetch`).
 */
const Results = lazyNamed(() => import('@/pages/buyer/Results'), 'Results');
const Boutiques = lazyNamed(() => import('@/pages/buyer/Boutiques'), 'Boutiques');
const BoutiqueProfile = lazyNamed(() => import('@/pages/buyer/BoutiqueProfile'), 'BoutiqueProfile');
const ProductDetail = lazyNamed(() => import('@/pages/buyer/ProductDetail'), 'ProductDetail');
const Wishlist = lazyNamed(() => import('@/pages/buyer/Wishlist'), 'Wishlist');
const Shortlists = lazyNamed(() => import('@/pages/buyer/Shortlists'), 'Shortlists');
const ShortlistDetail = lazyNamed(() => import('@/pages/buyer/ShortlistDetail'), 'ShortlistDetail');
const SharedBoard = lazyNamed(() => import('@/pages/buyer/SharedBoard'), 'SharedBoard');
const FilterSheet = lazyNamed(() => import('@/pages/buyer/FilterSheet'), 'FilterSheet');
const SortSheet = lazyNamed(() => import('@/pages/buyer/SortSheet'), 'SortSheet');
const Cart = lazyNamed(() => import('@/pages/buyer/Cart'), 'Cart');
const Checkout = lazyNamed(() => import('@/pages/buyer/Checkout'), 'Checkout');
const Payment = lazyNamed(() => import('@/pages/buyer/Payment'), 'Payment');
const OrderConfirmation = lazyNamed(() => import('@/pages/buyer/OrderConfirmation'), 'OrderConfirmation');
const MyOrders = lazyNamed(() => import('@/pages/buyer/MyOrders'), 'MyOrders');
const TrackOrder = lazyNamed(() => import('@/pages/buyer/TrackOrder'), 'TrackOrder');
const Coupons = lazyNamed(() => import('@/pages/buyer/Coupons'), 'Coupons');
const BuyerNotifications = lazyNamed(() => import('@/pages/buyer/Notifications'), 'Notifications');
const BuyerMessages = lazyNamed(() => import('@/pages/buyer/Messages'), 'Messages');
const BuyerChat = lazyNamed(() => import('@/pages/buyer/Chat'), 'Chat');
const BuyerProfile = lazyNamed(() => import('@/pages/buyer/Profile'), 'Profile');
const Policy = lazyNamed(() => import('@/pages/buyer/Policy'), 'Policy');
const Inspire = lazyNamed(() => import('@/pages/buyer/Inspire'), 'Inspire');
const Collections = lazyNamed(() => import('@/pages/buyer/Collections'), 'Collections');
/* Spelled out rather than via `lazyNamed`, which erases props: this is the one
   split page that takes any (`kind`). */
const CategoryLanding = lazy(() =>
  import('@/pages/buyer/CategoryLanding').then((m) => ({ default: m.CategoryLanding })),
);
const NewArrivals = lazyNamed(() => import('@/pages/buyer/NewArrivals'), 'NewArrivals');
const BestSellers = lazyNamed(() => import('@/pages/buyer/BestSellers'), 'BestSellers');
const TopBoutiques = lazyNamed(() => import('@/pages/buyer/TopBoutiques'), 'TopBoutiques');
const NotFound = lazyNamed(() => import('@/pages/buyer/NotFound'), 'NotFound');

/* The login flows are their own destinations, never rendered inside another
   screen, so they cost the storefront nothing until someone signs in. */
const SignIn = lazyNamed(() => import('@/pages/auth/SignIn'), 'SignIn');
const ResetPassword = lazyNamed(() => import('@/pages/auth/ResetPassword'), 'ResetPassword');
const SignUp = lazyNamed(() => import('@/pages/auth/SignUp'), 'SignUp');
const Otp = lazyNamed(() => import('@/pages/auth/Otp'), 'Otp');
const AuthCallback = lazyNamed(() => import('@/pages/auth/AuthCallback'), 'AuthCallback');
const AdminLogin = lazyNamed(() => import('@/pages/admin/AdminLogin'), 'AdminLogin');
const AdminResetPassword = lazyNamed(() => import('@/pages/admin/AdminResetPassword'), 'AdminResetPassword');

/**
 * Warms the chunks for the two screens almost every session reaches next — the
 * results grid and a product page — once the browser is idle and the current
 * page has finished its own work. Splitting the storefront trades bundle size
 * for a round trip on navigation; this pays that trip back before it is taken.
 *
 * Deliberately `requestIdleCallback` and not an effect on mount: on a slow
 * connection the LCP image and the catalogue queries must not be made to
 * compete with code for a screen nobody has asked for yet.
 */
function RoutePrefetch() {
  useEffect(() => {
    const warm = () => {
      void import('@/pages/buyer/Results');
      void import('@/pages/buyer/ProductDetail');
    };
    const ric = window.requestIdleCallback;
    if (typeof ric === 'function') {
      const handle = ric(warm, { timeout: 6000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(warm, 3000);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

const SellerLayout = lazyNamed(() => import('@/components/layout/SellerLayout'), 'SellerLayout');
const Dashboard = lazyNamed(() => import('@/pages/seller/Dashboard'), 'Dashboard');
const AddProduct = lazyNamed(() => import('@/pages/seller/AddProduct'), 'AddProduct');
const MyProducts = lazyNamed(() => import('@/pages/seller/MyProducts'), 'MyProducts');
const ProductAnalytics = lazyNamed(() => import('@/pages/seller/ProductAnalytics'), 'ProductAnalytics');
const SellerSearch = lazyNamed(() => import('@/pages/seller/Search'), 'Search');
const Orders = lazyNamed(() => import('@/pages/seller/Orders'), 'Orders');
const OrderDetail = lazyNamed(() => import('@/pages/seller/OrderDetail'), 'OrderDetail');
const Customers = lazyNamed(() => import('@/pages/seller/Customers'), 'Customers');
const Notifications = lazyNamed(() => import('@/pages/seller/Notifications'), 'Notifications');
const SellerMessages = lazyNamed(() => import('@/pages/seller/Messages'), 'Messages');
const SellerChat = lazyNamed(() => import('@/pages/seller/Chat'), 'Chat');
const Billing = lazyNamed(() => import('@/pages/seller/Billing'), 'Billing');
const Earnings = lazyNamed(() => import('@/pages/seller/Earnings'), 'Earnings');
const Analytics = lazyNamed(() => import('@/pages/seller/Analytics'), 'Analytics');
const Promote = lazyNamed(() => import('@/pages/seller/Promote'), 'Promote');
const SellerCoupons = lazyNamed(() => import('@/pages/seller/Coupons'), 'Coupons');
const BoutiqueProfileEdit = lazyNamed(() => import('@/pages/seller/BoutiqueProfileEdit'), 'BoutiqueProfileEdit');
const ProfileHub = lazyNamed(() => import('@/pages/seller/ProfileHub'), 'ProfileHub');
const Settings = lazyNamed(() => import('@/pages/seller/Settings'), 'Settings');
const Help = lazyNamed(() => import('@/pages/seller/Help'), 'Help');
const Verification = lazyNamed(() => import('@/pages/seller/Verification'), 'Verification');
const SellerReviews = lazyNamed(() => import('@/pages/seller/Reviews'), 'Reviews');
// Split like the rest of the seller console: the 7-step setup wizard is only
// ever opened by a seller, and buyers should not carry it in the main bundle.
const SellerOnboarding = lazyNamed(() => import('@/pages/seller/SellerOnboarding'), 'SellerOnboarding');

const AdminLayout = lazyNamed(() => import('@/components/layout/AdminLayout'), 'AdminLayout');
const Overview = lazyNamed(() => import('@/pages/admin/Overview'), 'Overview');
const Approvals = lazyNamed(() => import('@/pages/admin/Approvals'), 'Approvals');
const Catalogue = lazyNamed(() => import('@/pages/admin/Catalogue'), 'Catalogue');
const BoutiquesTable = lazyNamed(() => import('@/pages/admin/BoutiquesTable'), 'BoutiquesTable');
const Users = lazyNamed(() => import('@/pages/admin/Users'), 'Users');
const ProductsAdmin = lazyNamed(() => import('@/pages/admin/ProductsAdmin'), 'ProductsAdmin');
const OrdersAdmin = lazyNamed(() => import('@/pages/admin/OrdersAdmin'), 'OrdersAdmin');
const Payments = lazyNamed(() => import('@/pages/admin/Payments'), 'Payments');
const Ads = lazyNamed(() => import('@/pages/admin/Ads'), 'Ads');
const AdminCoupons = lazyNamed(() => import('@/pages/admin/Coupons'), 'Coupons');
const AdminNotifications = lazyNamed(() => import('@/pages/admin/Notifications'), 'Notifications');
const Refunds = lazyNamed(() => import('@/pages/admin/Refunds'), 'Refunds');
const ReviewsAdmin = lazyNamed(() => import('@/pages/admin/ReviewsAdmin'), 'ReviewsAdmin');
const Broadcast = lazyNamed(() => import('@/pages/admin/Broadcast'), 'Broadcast');
const Audit = lazyNamed(() => import('@/pages/admin/Audit'), 'Audit');
const Expenses = lazyNamed(() => import('@/pages/admin/Expenses'), 'Expenses');
const Deliveries = lazyNamed(() => import('@/pages/admin/Deliveries'), 'Deliveries');
const AdminSearch = lazyNamed(() => import('@/pages/admin/AdminSearch'), 'AdminSearch');
const Feedback = lazyNamed(() => import('@/pages/admin/Feedback'), 'Feedback');
const AdminSettings = lazyNamed(() => import('@/pages/admin/Settings'), 'Settings');
const StaffHome = lazyNamed(() => import('@/pages/admin/StaffHome'), 'StaffHome');
const AdminCustomers = lazyNamed(() => import('@/pages/admin/Customers'), 'Customers');

/** The console root itself — sends each role to the landing page it can open. */
function ConsoleHome() {
  const { profile } = useAuth();
  return <Navigate to={homeFor(profile?.role)} replace />;
}

export default function App() {
  return (
    <>
      {/* Every forward navigation starts at the top; back restores where you were. */}
      <ScrollManager />
      {/* Page sections fade and rise as they scroll into view, app-wide. */}
      <ScrollReveal />
      {/* Holds background refresh while the user is checking out or filling a form. */}
      <LiveRefreshGate />
      {/* Broadcasts this tab's live presence so the admin console can see who's on the site. */}
      <PresenceTracker />
      {/* GA4 / GTM page views on every route change. Inert until the IDs are set. */}
      <AnalyticsTracker />
      {/* "Launching soon" preview notice for public visitors (hidden in the consoles). */}
      <LaunchNotice />
      {/* Buyer-facing banner while Platform Settings → Maintenance mode is on. */}
      <MaintenanceNotice />
      {/* Corner ribbon that marks non-production (TEST/staging) builds. Renders
          nothing in production. See ENVIRONMENTS.md. */}
      <EnvBadge />
      {/* Warms the next-most-likely storefront chunks once the browser is idle. */}
      <RoutePrefetch />
      {/*
        The outer boundary only ever catches the full-page routes below (the
        login flows and the seller wizard) — every screen inside a console shell
        resolves against the `Suspense` that `AppShell` puts around its
        `<Outlet>`, so a route change swaps the page content without tearing
        down the header and the dock around it.
      */}
      <Suspense fallback={<FullscreenLoader />}>
      <Routes>
      <Route path="/auth/signin/:role" element={<SignIn />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      <Route path="/auth/signup/:role" element={<SignUp />} />
      <Route path="/auth/otp/:role" element={<Otp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      {/* Outside the seller console shell on purpose: the wizard is a full-page
          flow with its own header, and it runs before there is a boutique to
          put a nav bar around. /seller/register is the same wizard entered from
          the top — it opens on the account step for signed-out visitors, so
          "Create Boutique" is one flow rather than a signup page plus a wizard. */}
      {['/seller/register', '/seller/onboarding'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <Suspense fallback={<FullscreenLoader />}>
              <SellerOnboarding />
            </Suspense>
          }
        />
      ))}
      {/* The console's address is a deploy-time secret (VITE_ADMIN_PATH); see
          src/lib/adminPath.ts. `/admin` is deliberately NOT routed — it falls
          through to the 404 like any other unknown URL. */}
      <Route path={adminPath('login')} element={<AdminLogin />} />
      <Route path={adminPath('reset-password')} element={<AdminResetPassword />} />

      {/*
        ── The public storefront ───────────────────────────────────────────
        Buyers browse without signing in, so this whole tree is the site's
        indexable surface and it lives at the root.

        It used to sit under `/buyer/*`, with `/` serving a 2.5-second splash
        that then redirected — which meant the homepage was not a page, every
        product URL was a raw UUID, and browsing a category had no URL at all
        (the filter lived in React state). Search engines had one address for
        the entire catalogue.

        Paths are now what a shopper would expect to see and a crawler can
        make sense of: `/`, `/products/kanchipuram-silk-saree-1f2e3d4c`,
        `/boutique/elegance-boutique`, `/collections/sarees`. Every former
        path 301-redirects here from `vercel.json`, so no shared link, QR code
        or Instagram bio ever breaks.
      */}
      <Route path="/" element={<BuyerLayout />}>
        <Route index element={<Home />} />

        {/* The full grid. `/shop` is the browsable everything-page; `/search`
            is the same component in query mode and is deliberately noindex —
            an infinite space of query URLs is crawl-budget poison. */}
        <Route path="shop" element={<Results />} />
        <Route path="search" element={<Results />} />
        {/* The sheets are fixed overlays, so keep the results grid behind. */}
        <Route path="shop/filter" element={<><Results /><FilterSheet /></>} />
        <Route path="shop/sort" element={<><Results /><SortSheet /></>} />

        {/* The collection hub, and the landing pages it links into. These are
            the site's commercial keyword surface — one indexable page per
            category, occasion, fabric, colour and budget rung.
            Colour and budget were the two tiles on the hub that still only set a
            filter and pushed the buyer to the shared grid, so they had nothing
            to share and nothing to rank ("red silk saree", "saree under 2000"
            are both real queries). Same screen, same schema, one more kind. */}
        <Route path="collections" element={<Collections />} />
        <Route path="collections/:slug" element={<CategoryLanding kind="category" />} />
        <Route path="occasions/:slug" element={<CategoryLanding kind="occasion" />} />
        <Route path="fabrics/:slug" element={<CategoryLanding kind="fabric" />} />
        <Route path="colours/:slug" element={<CategoryLanding kind="colour" />} />
        <Route path="budget/:slug" element={<CategoryLanding kind="budget" />} />

        <Route path="boutiques" element={<Boutiques />} />
        {/* The per-city directory — `/boutiques/coimbatore`. Same screen; the
            route param is the city filter, so every city is a real URL that can
            be shared, sitemapped and ranked for "boutiques in <city>". Note the
            plural: `/boutique/:slug` below is a single shop. */}
        <Route path="boutiques/:citySlug" element={<Boutiques />} />
        {/* Accepts the boutique's slug (migration 0003) or its id — legacy
            `/b/:slug` and `/boutique/:id` links both land here. */}
        <Route path="boutique/:slug" element={<BoutiqueProfile />} />
        {/* Accepts `title-slug-idprefix` or a bare UUID; the page rewrites the
            latter to the former so only one form is ever canonical. */}
        <Route path="products/:slug" element={<ProductDetail />} />

        {/* The "See all" destinations behind the Home rails. Each one owns its
            own ranking rule (@/lib/ranking) and publishes it on the page. */}
        <Route path="new-arrivals" element={<NewArrivals />} />
        <Route path="best-sellers" element={<BestSellers />} />
        <Route path="top-boutiques" element={<TopBoutiques />} />
        {/* Inspire — the feed of posts from boutiques the buyer follows. */}
        <Route path="inspire" element={<Inspire />} />

        {/* Private to one buyer or a step in a transaction — all noindex. */}
        <Route path="wishlist" element={<Wishlist />} />
        {/* "Ask my people" (migration 0077). Her own boards are private; the
            share link is not private-by-auth but private-by-token, and it sits
            inside this tree on purpose — a relative who opened it to judge four
            sarees is a shopper standing in the shop, with the storefront's
            header and nav around them and a real PDP behind every piece. Both
            prefixes are noindex in middleware.js. */}
        <Route path="shortlists" element={<Shortlists />} />
        <Route path="shortlists/:id" element={<ShortlistDetail />} />
        <Route path="shortlist/:token" element={<SharedBoard />} />
        <Route path="cart" element={<Cart />} />
        {/* Checkout and payment need a real account behind the order — see
            src/auth/SignInGate.tsx. The bag stays open to everyone; the two
            screens that turn it into an order do not, and a signed-out buyer
            deep-linking here is sent to sign in and returned afterwards. */}
        <Route path="checkout" element={<RequireSignIn><Checkout /></RequireSignIn>} />
        <Route path="payment" element={<RequireSignIn><Payment /></RequireSignIn>} />
        <Route path="order-confirmation" element={<OrderConfirmation />} />
        <Route path="orders" element={<MyOrders />} />
        {/* Order detail and tracking are one screen — the buyer's question is
            always "where is it and what was in it". */}
        <Route path="orders/:id" element={<TrackOrder />} />
        <Route path="orders/:id/track" element={<TrackOrder />} />
        <Route path="coupons" element={<Coupons />} />
        <Route path="notifications" element={<BuyerNotifications />} />
        <Route path="messages" element={<BuyerMessages />} />
        <Route path="chat/:id" element={<BuyerChat />} />
        <Route path="profile" element={<BuyerProfile />} />

        {/* Policies, About and Help sit at the root — `/privacy-policy`, not
            `/privacy-policy`. Registered one route per known slug
            rather than as a `/:slug` catch-all, so an unknown path still
            reaches the 404 below instead of rendering an empty policy shell. */}
        {POLICY_SLUGS.map((slug) => (
          <Route key={slug} path={slug} element={<Policy />} />
        ))}

        {/* A real 404. Every unknown URL used to soft-redirect to the splash,
            which returns HTTP 200 and tells a crawler the page exists. */}
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route
        path="/seller"
        element={
          <RequireRole role="seller">
            <Suspense fallback={<FullscreenLoader />}>
              <SellerLayout />
            </Suspense>
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="add-product" element={<AddProduct />} />
        {/* Products are also the Inspire feed — listing a piece publishes it to
            followers, so there is no separate composer route. */}
        <Route path="products" element={<MyProducts />} />
        <Route path="products/:id" element={<ProductAnalytics />} />
        <Route path="reviews" element={<SellerReviews />} />
        <Route path="search" element={<SellerSearch />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="customers" element={<Customers />} />
        <Route path="billing" element={<Billing />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="messages" element={<SellerMessages />} />
        <Route path="chat/:id" element={<SellerChat />} />
        <Route path="earnings" element={<Earnings />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="promote" element={<Promote />} />
        <Route path="coupons" element={<SellerCoupons />} />
        <Route path="boutique" element={<BoutiqueProfileEdit />} />
        <Route path="profile" element={<ProfileHub />} />
        <Route path="settings" element={<Settings />} />
        <Route path="help" element={<Help />} />
        {/* Where the setup wizard lands, and what the console's status banner
            links to while a boutique is unapproved. */}
        <Route path="verification" element={<Verification />} />
      </Route>

      <Route
        path={ADMIN_BASE}
        element={
          <RequireRole role="admin">
            <Suspense fallback={<FullscreenLoader />}>
              <AdminLayout />
            </Suspense>
          </RequireRole>
        }
      >
        {/* Two console roles, two landing pages — an employee cannot open
            Overview, which is the revenue screen (migration 0086). */}
        <Route index element={<ConsoleHome />} />
        <Route path="overview" element={<Overview />} />
        <Route path="staff" element={<StaffHome />} />
        <Route path="approvals" element={<Approvals />} />
        {/* The catalogue vocabulary sellers pick from and buyers browse by. */}
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="boutiques" element={<BoutiquesTable />} />
        <Route path="users" element={<Users />} />
        <Route path="products" element={<ProductsAdmin />} />
        <Route path="orders" element={<OrdersAdmin />} />
        {/* Courier tracking's admin side (0063): disputes that freeze a payout,
            stalled parcels, and the courier list sellers pick from. */}
        <Route path="deliveries" element={<Deliveries />} />
        {/* Private post-delivery feedback about the platform itself (0071).
            Public product reviews are moderated at /admin/reviews. */}
        <Route path="feedback" element={<Feedback />} />
        {/* Folded into Overview and Users as tabs to shorten a 20-item sidebar.
            Kept as redirects rather than deleted: both were linked from the nav
            for months, so bookmarks and old notification links exist. */}
        <Route path="reports" element={<Navigate to={adminPath('overview')} replace />} />
        <Route path="payments" element={<Payments />} />
        {/* The outgoing side of the ledger — spends with their receipts (0056). */}
        <Route path="expenses" element={<Expenses />} />
        <Route path="ads" element={<Ads />} />
        <Route path="coupons" element={<AdminCoupons />} />
        <Route path="notifications" element={<AdminNotifications />} />
        {/* New admin operations surfaces (backend: migration 0048 + admin_activity_log). */}
        {/* Was a redirect to /admin/users, back when this page had no nav tile.
            It is now the staff customer directory — the same aggregate as the
            Users page's buyer tab, with no account controls and no contact
            details. Admins still reach customers from Users. */}
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="refunds" element={<Refunds />} />
        <Route path="reviews" element={<ReviewsAdmin />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<AdminSettings />} />
        {/* "See all results" from the header search box. */}
        <Route path="search" element={<AdminSearch />} />
      </Route>

      </Routes>
      </Suspense>
    </>
  );
}
