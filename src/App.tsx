import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { RequireRole, FullscreenLoader } from '@/auth/RequireRole';
import { ScrollManager } from '@/components/layout/ScrollManager';
import { ScrollReveal } from '@/components/layout/ScrollReveal';
import { LiveRefreshGate } from '@/components/layout/LiveRefreshGate';
import { PresenceTracker } from '@/components/layout/PresenceTracker';
import { LaunchNotice } from '@/components/layout/LaunchNotice';
import { MaintenanceNotice } from '@/components/layout/MaintenanceNotice';
import { EnvBadge } from '@/components/layout/EnvBadge';

import { Loading } from '@/pages/Loading';
import { SignIn } from '@/pages/auth/SignIn';
import { ResetPassword } from '@/pages/auth/ResetPassword';
import { SignUp } from '@/pages/auth/SignUp';
import { Otp } from '@/pages/auth/Otp';
import { AuthCallback } from '@/pages/auth/AuthCallback';
import { AdminLogin } from '@/pages/admin/AdminLogin';
import { AdminResetPassword } from '@/pages/admin/AdminResetPassword';

import { BuyerLayout } from '@/components/layout/BuyerLayout';
import { Home } from '@/pages/buyer/Home';
import { Results } from '@/pages/buyer/Results';
import { Boutiques } from '@/pages/buyer/Boutiques';
import { BoutiqueProfile } from '@/pages/buyer/BoutiqueProfile';
import { ProductDetail } from '@/pages/buyer/ProductDetail';
import { Wishlist } from '@/pages/buyer/Wishlist';
import { FilterSheet } from '@/pages/buyer/FilterSheet';
import { SortSheet } from '@/pages/buyer/SortSheet';
import { Cart } from '@/pages/buyer/Cart';
import { Checkout } from '@/pages/buyer/Checkout';
import { Payment } from '@/pages/buyer/Payment';
import { OrderConfirmation } from '@/pages/buyer/OrderConfirmation';
import { MyOrders } from '@/pages/buyer/MyOrders';
import { TrackOrder } from '@/pages/buyer/TrackOrder';
import { Coupons } from '@/pages/buyer/Coupons';
import { Notifications as BuyerNotifications } from '@/pages/buyer/Notifications';
import { Messages as BuyerMessages } from '@/pages/buyer/Messages';
import { Chat as BuyerChat } from '@/pages/buyer/Chat';
import { Profile as BuyerProfile } from '@/pages/buyer/Profile';
import { Policy } from '@/pages/buyer/Policy';
import { Inspire } from '@/pages/buyer/Inspire';
import { Collections } from '@/pages/buyer/Collections';
import { NewArrivals } from '@/pages/buyer/NewArrivals';
import { BestSellers } from '@/pages/buyer/BestSellers';
import { TopBoutiques } from '@/pages/buyer/TopBoutiques';

/**
 * The seller and admin consoles are only ever reached by signed-in
 * sellers/admins (gated by RequireRole), so their code is split into
 * per-route chunks with React.lazy. A first-time buyer no longer downloads
 * the entire seller + admin bundle just to view a product. The page modules
 * use named exports, so each import is remapped to a default for lazy().
 */
const lazyNamed = <M, K extends keyof M>(loader: () => Promise<M>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));

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
const Reports = lazyNamed(() => import('@/pages/admin/Reports'), 'Reports');
const Payments = lazyNamed(() => import('@/pages/admin/Payments'), 'Payments');
const Ads = lazyNamed(() => import('@/pages/admin/Ads'), 'Ads');
const AdminCoupons = lazyNamed(() => import('@/pages/admin/Coupons'), 'Coupons');
const AdminNotifications = lazyNamed(() => import('@/pages/admin/Notifications'), 'Notifications');
const AdminCustomers = lazyNamed(() => import('@/pages/admin/Customers'), 'Customers');
const Refunds = lazyNamed(() => import('@/pages/admin/Refunds'), 'Refunds');
const ReviewsAdmin = lazyNamed(() => import('@/pages/admin/ReviewsAdmin'), 'ReviewsAdmin');
const Broadcast = lazyNamed(() => import('@/pages/admin/Broadcast'), 'Broadcast');
const Audit = lazyNamed(() => import('@/pages/admin/Audit'), 'Audit');
const AdminSettings = lazyNamed(() => import('@/pages/admin/Settings'), 'Settings');

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
      {/* "Launching soon" preview notice for public visitors (hidden in the consoles). */}
      <LaunchNotice />
      {/* Buyer-facing banner while Platform Settings → Maintenance mode is on. */}
      <MaintenanceNotice />
      {/* Corner ribbon that marks non-production (TEST/staging) builds. Renders
          nothing in production. See ENVIRONMENTS.md. */}
      <EnvBadge />
      <Routes>
      <Route path="/" element={<Loading />} />
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
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin/reset-password" element={<AdminResetPassword />} />

      {/* Clean, shareable public boutique link — e.g. /b/elegance-boutique.
          Renders the same profile the buyer app uses, so a link dropped in an
          Instagram bio or WhatsApp status deep-links straight to the boutique. */}
      <Route path="/b/:slug" element={<BoutiqueProfile />} />

      {/* Buyers browse without signing in — the design treats the buyer app as
          the public surface and only gates the seller/admin consoles. */}
      <Route path="/buyer" element={<BuyerLayout />}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="results" element={<Results />} />
        {/* The sheet is a fixed overlay, so keep the results grid behind it. */}
        <Route path="filter" element={<><Results /><FilterSheet /></>} />
        {/* Sort shares the results grid behind a lighter sort-only sheet. */}
        <Route path="sort" element={<><Results /><SortSheet /></>} />
        <Route path="boutiques" element={<Boutiques />} />
        {/* The "See all" destinations behind the Home rails. Each one owns its
            own ranking rule (@/lib/ranking) and publishes it on the page. */}
        <Route path="collections" element={<Collections />} />
        <Route path="new-arrivals" element={<NewArrivals />} />
        <Route path="best-sellers" element={<BestSellers />} />
        <Route path="top-boutiques" element={<TopBoutiques />} />
        {/* Inspire — the feed of posts from boutiques the buyer follows. */}
        <Route path="inspire" element={<Inspire />} />
        <Route path="boutique/:id" element={<BoutiqueProfile />} />
        <Route path="product/:id" element={<ProductDetail />} />
        <Route path="wishlist" element={<Wishlist />} />
        <Route path="cart" element={<Cart />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="payment" element={<Payment />} />
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
        {/* Policies, About and Help — content lives in @/data/policies. */}
        <Route path="policy/:slug" element={<Policy />} />
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
        path="/admin"
        element={
          <RequireRole role="admin">
            <Suspense fallback={<FullscreenLoader />}>
              <AdminLayout />
            </Suspense>
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="approvals" element={<Approvals />} />
        {/* The catalogue vocabulary sellers pick from and buyers browse by. */}
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="boutiques" element={<BoutiquesTable />} />
        <Route path="users" element={<Users />} />
        <Route path="products" element={<ProductsAdmin />} />
        <Route path="orders" element={<OrdersAdmin />} />
        <Route path="reports" element={<Reports />} />
        <Route path="payments" element={<Payments />} />
        <Route path="ads" element={<Ads />} />
        <Route path="coupons" element={<AdminCoupons />} />
        <Route path="notifications" element={<AdminNotifications />} />
        {/* New admin operations surfaces (backend: migration 0048 + admin_activity_log). */}
        <Route path="customers" element={<AdminCustomers />} />
        <Route path="refunds" element={<Refunds />} />
        <Route path="reviews" element={<ReviewsAdmin />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SpeedInsights />
    </>
  );
}
