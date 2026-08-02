import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';

/**
 * "Are you a Boutique Owner?" sheet, opened from the buyer profile.
 * This is the entry point into the gated seller flow.
 */
export function SellModal() {
  const navigate = useNavigate();
  const { closeSellModal } = useShop();

  const goLogin = () => {
    closeSellModal();
    navigate('/auth/signin/seller');
  };

  // Straight into the registration wizard — it creates the account as its own
  // first step, so there is no separate signup page to pass through.
  const goCreate = () => {
    closeSellModal();
    navigate('/seller/register');
  };

  return (
    <div
      onClick={closeSellModal}
      style={css('position:fixed;inset:0;z-index:210;background:rgba(40,10,22,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:100%;max-width:460px;margin:auto;background:var(--ag-surface);border-radius:28px;padding:24px 24px 28px;box-shadow:0 30px 80px -30px rgba(107,20,54,.6);')}
      >
        <div style={css('width:58px;height:58px;border-radius:18px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 16px 34px -16px rgba(214,51,108,.8);')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:30px;")}>storefront</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;text-align:center;margin-top:16px;line-height:1.1;")}>
          Are you a Boutique Owner?
        </div>
        <div style={css('text-align:center;color:var(--ag-muted);font-size:14px;margin-top:9px;line-height:1.55;max-width:340px;margin-left:auto;margin-right:auto;')}>
          Sell your creations to thousands of shoppers across Tamil Nadu. Manage orders, chat with buyers and grow your boutique on MangaiMart.
        </div>
        <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:24px;')}>
          <button
            onClick={goLogin}
            style={css('height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>login</span>Login
          </button>
          <button
            onClick={goCreate}
            style={css('height:54px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>add_business</span>Create Boutique
          </button>
          <button
            onClick={closeSellModal}
            style={css('height:44px;border:none;background:none;color:var(--ag-muted);font-weight:700;font-size:14px;cursor:pointer;')}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
